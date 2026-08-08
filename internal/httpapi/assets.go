package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/engus/myfinance/internal/api"
	"github.com/engus/myfinance/internal/money"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

var ownershipSharePattern = regexp.MustCompile(`^(?:100(?:\.0{1,2})?|(?:[1-9]|[1-9][0-9])(?:\.\d{1,2})?|0\.\d{1,2})$`)

type assetRow struct {
	ID, LedgerAccountID                 uuid.UUID
	Name, AssetType, Currency           string
	OwnershipShare                      string
	Country, Region, Institution, Notes pgtype.Text
	Archived                            bool
	LedgerAccountName, LedgerBalance    string
	LatestMarketValue, LatestOwnedValue pgtype.Text
	LatestValuationDate                 pgtype.Date
	PurchaseTransactionID               pgtype.UUID
	CreatedAt                           time.Time
}

func (server *Server) ListAssets(writer http.ResponseWriter, request *http.Request, params api.ListAssetsParams) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	if err := server.ensureLedger(request.Context(), authenticated.userID); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	includeArchived := params.IncludeArchived != nil && *params.IncludeArchived
	assets, err := server.listAssets(request.Context(), authenticated.userID, includeArchived)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	total, _ := money.Parse("0")
	byType := make(map[api.AssetType]money.Amount)
	for _, asset := range assets {
		value, err := money.Parse(asset.CurrentOwnedValue)
		if err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		total = total.Add(value)
		byType[asset.Type] = byType[asset.Type].Add(value)
	}
	allocations := make([]api.AssetAllocation, 0, len(byType))
	for _, assetType := range []api.AssetType{api.REALESTATE, api.SECURITIES, api.BUSINESS, api.VEHICLE, api.COLLECTIBLES, api.OTHER} {
		if value, exists := byType[assetType]; exists {
			allocations = append(allocations, api.AssetAllocation{Type: assetType, CurrentOwnedValue: value.String()})
		}
	}
	writeJSON(writer, http.StatusOK, api.AssetListResponse{Assets: assets, Allocations: allocations, TotalCurrentOwnedValue: total.String()})
}

func (server *Server) CreateAsset(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.CreateAssetRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter valid asset details.")
		return
	}
	fields := validateAssetCreate(payload)
	if len(fields) > 0 {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", fields)
		return
	}
	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	functionalCurrency, _, err := ensureLedgerInfrastructure(request.Context(), tx, authenticated.userID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if string(payload.Currency) != functionalCurrency {
		server.writeLedgerError(writer, request, errFXUnavailable)
		return
	}
	var existingID uuid.UUID
	err = tx.QueryRow(request.Context(), `SELECT id FROM assets WHERE user_id = $1 AND creation_idempotency_key = $2 FOR UPDATE`, authenticated.userID, payload.IdempotencyKey).Scan(&existingID)
	if err == nil {
		if err := tx.Commit(request.Context()); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		asset, err := server.getAsset(request.Context(), authenticated.userID, existingID)
		if err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		writeJSON(writer, http.StatusCreated, asset)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		server.writeLedgerError(writer, request, err)
		return
	}

	assetID, accountID := uuid.New(), uuid.New()
	if payload.LedgerAccountId != nil {
		accountID = *payload.LedgerAccountId
		var accountClass, currency string
		var archived bool
		err := tx.QueryRow(request.Context(), `
			SELECT account_class, currency::text, archived_at IS NOT NULL
			FROM ledger_accounts WHERE id = $1 AND user_id = $2 AND role = 'USER' FOR UPDATE`, accountID, authenticated.userID).
			Scan(&accountClass, &currency, &archived)
		if errors.Is(err, pgx.ErrNoRows) {
			server.writeLedgerError(writer, request, errLedgerNotFound)
			return
		}
		if err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		if accountClass != "ASSET" || archived {
			server.writeLedgerError(writer, request, fmt.Errorf("%w: choose an active asset account", errLedgerValidation))
			return
		}
		if currency != functionalCurrency {
			server.writeLedgerError(writer, request, errFXUnavailable)
			return
		}
	} else {
		if _, err := tx.Exec(request.Context(), `
			INSERT INTO ledger_accounts (id, user_id, name, account_class, subtype, role, currency)
			VALUES ($1, $2, $3, 'ASSET', $4, 'USER', $5)`, accountID, authenticated.userID,
			strings.TrimSpace(payload.Name), assetAccountSubtype(payload.Type), functionalCurrency); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
	}
	_, err = tx.Exec(request.Context(), `
		INSERT INTO assets (
			id, user_id, ledger_account_id, name, asset_type, currency, ownership_share,
			country, region, institution, notes, creation_idempotency_key)
		VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10, $11, $12)`,
		assetID, authenticated.userID, accountID, strings.TrimSpace(payload.Name), string(payload.Type), string(payload.Currency), strings.TrimSpace(payload.OwnershipShare),
		nullableTrimmed(payload.Country), nullableTrimmed(payload.Region), nullableTrimmed(payload.Institution), nullableTrimmed(payload.Notes), payload.IdempotencyKey)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if payload.Purchase != nil {
		purchase := payload.Purchase
		amount, err := money.Parse(purchase.Amount)
		if err != nil || !amount.IsPositive() {
			server.writeLedgerError(writer, request, fmt.Errorf("%w: purchase amount must be greater than zero", errLedgerValidation))
			return
		}
		var source ledgerAccount
		var archivedAt pgtype.Timestamptz
		err = tx.QueryRow(request.Context(), `
			SELECT id, name, account_class, subtype, currency::text, archived_at
			FROM ledger_accounts WHERE id = $1 AND user_id = $2 AND role = 'USER' FOR UPDATE`, purchase.SourceAccountId, authenticated.userID).
			Scan(&source.ID, &source.Name, &source.Class, &source.Subtype, &source.Currency, &archivedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			server.writeLedgerError(writer, request, errLedgerNotFound)
			return
		}
		if err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		if source.ID == accountID || source.Class != "ASSET" || archivedAt.Valid {
			server.writeLedgerError(writer, request, fmt.Errorf("%w: choose a different active asset account to fund this purchase", errLedgerValidation))
			return
		}
		if source.Currency != functionalCurrency {
			server.writeLedgerError(writer, request, errFXUnavailable)
			return
		}
		description := purchase.Description
		if description == nil {
			value := "Asset purchase · " + strings.TrimSpace(payload.Name)
			description = &value
		} else {
			value := strings.TrimSpace(*description)
			if value == "" || len(value) > 500 {
				server.writeLedgerError(writer, request, fmt.Errorf("%w: purchase description must contain between 1 and 500 characters", errLedgerValidation))
				return
			}
			description = &value
		}
		purchaseKey := uuid.NewSHA1(uuid.NameSpaceOID, []byte("myfinance:asset-purchase:"+assetID.String()))
		transactionID, _, err := postJournal(request.Context(), tx, authenticated.userID, journalSpec{
			Type: "ASSET_PURCHASE", EventDate: purchase.EventDate.Time, Description: description, IdempotencyKey: purchaseKey,
			Entries: []journalEntry{
				{AccountID: source.ID, Amount: amount.Negate().String(), Currency: source.Currency},
				{AccountID: accountID, Amount: amount.String(), Currency: functionalCurrency},
			},
		})
		if err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		if _, err := tx.Exec(request.Context(), `UPDATE assets SET purchase_transaction_id = $2, updated_at = now() WHERE id = $1`, assetID, transactionID); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
	}
	if err := tx.Commit(request.Context()); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	asset, err := server.getAsset(request.Context(), authenticated.userID, assetID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusCreated, asset)
}

func (server *Server) GetAsset(writer http.ResponseWriter, request *http.Request, assetID api.AssetId) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	asset, err := server.getAsset(request.Context(), authenticated.userID, assetID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, asset)
}

func (server *Server) UpdateAsset(writer http.ResponseWriter, request *http.Request, assetID api.AssetId) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.UpdateAssetRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter valid asset changes.")
		return
	}
	if payload.Name == nil && payload.Country == nil && payload.Region == nil && payload.Institution == nil && payload.Notes == nil && payload.Archived == nil {
		writeError(writer, http.StatusBadRequest, "empty_update", "Choose at least one asset change.")
		return
	}
	fields := validateAssetUpdate(payload)
	if len(fields) > 0 {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", fields)
		return
	}
	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	var accountID uuid.UUID
	err = tx.QueryRow(request.Context(), `SELECT ledger_account_id FROM assets WHERE id = $1 AND user_id = $2 FOR UPDATE`, assetID, authenticated.userID).Scan(&accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		server.writeLedgerError(writer, request, errLedgerNotFound)
		return
	}
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	_, err = tx.Exec(request.Context(), `
		UPDATE assets SET name = COALESCE($3, name), country = COALESCE($4, country), region = COALESCE($5, region),
			institution = COALESCE($6, institution), notes = COALESCE($7, notes),
			archived_at = CASE WHEN $8::boolean IS NULL THEN archived_at WHEN $8 THEN COALESCE(archived_at, now()) ELSE NULL END,
			updated_at = now() WHERE id = $1 AND user_id = $2`, assetID, authenticated.userID, nullableTrimmed(payload.Name), nullableTrimmed(payload.Country), nullableTrimmed(payload.Region), nullableTrimmed(payload.Institution), nullableTrimmed(payload.Notes), payload.Archived)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if payload.Archived != nil {
		if _, err := tx.Exec(request.Context(), `UPDATE ledger_accounts SET archived_at = CASE WHEN $3 THEN COALESCE(archived_at, now()) ELSE NULL END, updated_at = now() WHERE id = $1 AND user_id = $2`, accountID, authenticated.userID, *payload.Archived); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
	}
	if err := tx.Commit(request.Context()); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	asset, err := server.getAsset(request.Context(), authenticated.userID, assetID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, asset)
}

func (server *Server) ListAssetValuations(writer http.ResponseWriter, request *http.Request, assetID api.AssetId) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	if _, err := server.getAsset(request.Context(), authenticated.userID, assetID); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	rows, err := server.pool.Query(request.Context(), `
		SELECT id, asset_id, valuation_date, market_value::text, owned_value::text, ledger_balance_before::text,
		       adjustment_amount::text, notes, revaluation_transaction_id, created_at
		FROM asset_valuations WHERE user_id = $1 AND asset_id = $2
		ORDER BY valuation_date DESC, created_at DESC`, authenticated.userID, assetID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer rows.Close()
	valuations := make([]api.AssetValuation, 0)
	for rows.Next() {
		valuation, err := scanAssetValuation(rows)
		if err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		valuations = append(valuations, valuation)
	}
	if err := rows.Err(); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, api.AssetValuationListResponse{Valuations: valuations})
}

func (server *Server) CreateAssetValuation(writer http.ResponseWriter, request *http.Request, assetID api.AssetId) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.CreateAssetValuationRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter a valid manual valuation.")
		return
	}
	marketValue, err := money.Parse(payload.MarketValue)
	fields := map[string]string{}
	if err != nil || (!marketValue.IsPositive() && !marketValue.IsZero()) {
		fields["marketValue"] = "Enter a non-negative exact decimal with up to 8 fractional digits."
	}
	if payload.Notes != nil && len(strings.TrimSpace(*payload.Notes)) > 1000 {
		fields["notes"] = "Notes must contain at most 1000 characters."
	}
	if len(fields) > 0 {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", fields)
		return
	}
	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	functionalCurrency, _, err := ensureLedgerInfrastructure(request.Context(), tx, authenticated.userID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	var accountID uuid.UUID
	var share, currency, name string
	var archivedAt pgtype.Timestamptz
	err = tx.QueryRow(request.Context(), `
		SELECT asset.ledger_account_id, asset.ownership_share::text, asset.currency::text, asset.name, asset.archived_at
		FROM assets asset WHERE asset.id = $1 AND asset.user_id = $2 FOR UPDATE`, assetID, authenticated.userID).
		Scan(&accountID, &share, &currency, &name, &archivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		server.writeLedgerError(writer, request, errLedgerNotFound)
		return
	}
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if archivedAt.Valid {
		server.writeLedgerError(writer, request, fmt.Errorf("%w: archived assets cannot receive valuations", errLedgerConflict))
		return
	}
	if currency != functionalCurrency {
		server.writeLedgerError(writer, request, errFXUnavailable)
		return
	}
	var existingID uuid.UUID
	err = tx.QueryRow(request.Context(), `SELECT id FROM asset_valuations WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE`, authenticated.userID, payload.IdempotencyKey).Scan(&existingID)
	if err == nil {
		if err := tx.Commit(request.Context()); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		valuation, err := server.getAssetValuation(request.Context(), authenticated.userID, existingID)
		if err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		writeJSON(writer, http.StatusCreated, valuation)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		server.writeLedgerError(writer, request, err)
		return
	}
	var latestDate pgtype.Date
	if err := tx.QueryRow(request.Context(), `SELECT valuation_date FROM asset_valuations WHERE asset_id = $1 ORDER BY valuation_date DESC, created_at DESC LIMIT 1`, assetID).Scan(&latestDate); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		server.writeLedgerError(writer, request, err)
		return
	}
	if latestDate.Valid && payload.ValuationDate.Time.Before(latestDate.Time) {
		server.writeLedgerError(writer, request, fmt.Errorf("%w: valuations must be dated on or after the latest valuation", errLedgerConflict))
		return
	}
	var ownedText string
	if err := tx.QueryRow(request.Context(), `SELECT round($1::numeric * $2::numeric / 100, 8)::text`, marketValue.String(), share).Scan(&ownedText); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	ownedValue, err := money.Parse(ownedText)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if _, err := tx.Exec(request.Context(), `SELECT id FROM ledger_accounts WHERE id = $1 AND user_id = $2 FOR UPDATE`, accountID, authenticated.userID); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	ledgerBalance, err := accountBalanceAt(request.Context(), tx, authenticated.userID, accountID, payload.ValuationDate.Time)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	adjustment := ownedValue.Add(ledgerBalance.Negate())
	var transactionID *uuid.UUID
	if !adjustment.IsZero() {
		var unrealizedID uuid.UUID
		if err := tx.QueryRow(request.Context(), `SELECT id FROM ledger_accounts WHERE user_id = $1 AND system_code = 'UNREALIZED_GAIN_LOSS' FOR UPDATE`, authenticated.userID).Scan(&unrealizedID); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		description := fmt.Sprintf("Manual revaluation · %s · %s", name, payload.ValuationDate.Time.Format("2006-01-02"))
		key := uuid.NewSHA1(uuid.NameSpaceOID, []byte("myfinance:asset-revaluation:"+assetID.String()+":"+payload.IdempotencyKey.String()))
		id, _, err := postJournal(request.Context(), tx, authenticated.userID, journalSpec{
			Type: "REVALUATION", EventDate: payload.ValuationDate.Time, Description: &description, IdempotencyKey: key,
			Entries: []journalEntry{
				{AccountID: accountID, Amount: adjustment.String(), Currency: functionalCurrency},
				{AccountID: unrealizedID, Amount: adjustment.Negate().String(), Currency: functionalCurrency},
			},
		})
		if err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		transactionID = &id
	}
	valuationID := uuid.New()
	_, err = tx.Exec(request.Context(), `
		INSERT INTO asset_valuations (
			id, user_id, asset_id, valuation_date, market_value, owned_value, ledger_balance_before,
			adjustment_amount, notes, idempotency_key, revaluation_transaction_id)
		VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9, $10, $11)`,
		valuationID, authenticated.userID, assetID, payload.ValuationDate.Time, marketValue.String(), ownedValue.String(), ledgerBalance.String(), adjustment.String(), nullableTrimmed(payload.Notes), payload.IdempotencyKey, transactionID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if err := tx.Commit(request.Context()); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	valuation, err := server.getAssetValuation(request.Context(), authenticated.userID, valuationID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusCreated, valuation)
}

func (server *Server) listAssets(ctx context.Context, userID pgtype.UUID, includeArchived bool) ([]api.Asset, error) {
	rows, err := server.pool.Query(ctx, assetSelect+` WHERE asset.user_id = $1 AND ($2 OR (asset.archived_at IS NULL AND account.archived_at IS NULL)) ORDER BY asset.archived_at NULLS FIRST, asset.created_at, asset.id`, userID, includeArchived)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assets := make([]api.Asset, 0)
	for rows.Next() {
		row, err := scanAssetRow(rows)
		if err != nil {
			return nil, err
		}
		assets = append(assets, apiAsset(row))
	}
	return assets, rows.Err()
}

func (server *Server) getAsset(ctx context.Context, userID pgtype.UUID, assetID uuid.UUID) (api.Asset, error) {
	row, err := scanAssetRow(server.pool.QueryRow(ctx, assetSelect+` WHERE asset.user_id = $1 AND asset.id = $2`, userID, assetID))
	if errors.Is(err, pgx.ErrNoRows) {
		return api.Asset{}, errLedgerNotFound
	}
	if err != nil {
		return api.Asset{}, err
	}
	return apiAsset(row), nil
}

const assetSelect = `
	SELECT asset.id, asset.ledger_account_id, asset.name, asset.asset_type, asset.currency::text, asset.ownership_share::text,
	       asset.country, asset.region, asset.institution, asset.notes,
	       asset.archived_at IS NOT NULL OR account.archived_at IS NOT NULL,
	       account.name, balance.value::text, valuation.market_value::text, valuation.owned_value::text, valuation.valuation_date,
	       asset.purchase_transaction_id, asset.created_at
	FROM assets asset
	JOIN ledger_accounts account ON account.id = asset.ledger_account_id
	CROSS JOIN LATERAL (
		SELECT COALESCE(sum(entry.original_amount), 0) AS value FROM ledger_entries entry
		WHERE entry.user_id = asset.user_id AND entry.account_id = asset.ledger_account_id
	) balance
	LEFT JOIN LATERAL (
		SELECT market_value, owned_value, valuation_date FROM asset_valuations
		WHERE asset_id = asset.id ORDER BY valuation_date DESC, created_at DESC LIMIT 1
	) valuation ON true`

type assetScanner interface{ Scan(...any) error }

func scanAssetRow(scanner assetScanner) (assetRow, error) {
	var row assetRow
	err := scanner.Scan(&row.ID, &row.LedgerAccountID, &row.Name, &row.AssetType, &row.Currency, &row.OwnershipShare,
		&row.Country, &row.Region, &row.Institution, &row.Notes, &row.Archived, &row.LedgerAccountName, &row.LedgerBalance,
		&row.LatestMarketValue, &row.LatestOwnedValue, &row.LatestValuationDate, &row.PurchaseTransactionID, &row.CreatedAt)
	return row, err
}

func apiAsset(row assetRow) api.Asset {
	current := row.LedgerBalance
	if row.LatestOwnedValue.Valid {
		current = row.LatestOwnedValue.String
	}
	result := api.Asset{Id: row.ID, Name: row.Name, Type: api.AssetType(row.AssetType), Currency: api.Currency(row.Currency), OwnershipShare: row.OwnershipShare,
		LedgerAccountId: row.LedgerAccountID, LedgerAccountName: row.LedgerAccountName, LedgerBalance: canonicalAmount(row.LedgerBalance), CurrentOwnedValue: canonicalAmount(current), Archived: row.Archived, CreatedAt: row.CreatedAt}
	if row.Country.Valid {
		result.Country = &row.Country.String
	}
	if row.Region.Valid {
		result.Region = &row.Region.String
	}
	if row.Institution.Valid {
		result.Institution = &row.Institution.String
	}
	if row.Notes.Valid {
		result.Notes = &row.Notes.String
	}
	if row.LatestMarketValue.Valid {
		value := canonicalAmount(row.LatestMarketValue.String)
		result.LatestMarketValue = &value
	}
	if row.LatestValuationDate.Valid {
		value := openapi_types.Date{Time: row.LatestValuationDate.Time}
		result.LatestValuationDate = &value
	}
	if row.PurchaseTransactionID.Valid {
		id := uuid.UUID(row.PurchaseTransactionID.Bytes)
		result.PurchaseTransactionId = &id
	}
	return result
}

func (server *Server) getAssetValuation(ctx context.Context, userID pgtype.UUID, valuationID uuid.UUID) (api.AssetValuation, error) {
	row := server.pool.QueryRow(ctx, `SELECT id, asset_id, valuation_date, market_value::text, owned_value::text, ledger_balance_before::text, adjustment_amount::text, notes, revaluation_transaction_id, created_at FROM asset_valuations WHERE id = $1 AND user_id = $2`, valuationID, userID)
	valuation, err := scanAssetValuation(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return api.AssetValuation{}, errLedgerNotFound
	}
	return valuation, err
}

func scanAssetValuation(scanner assetScanner) (api.AssetValuation, error) {
	var valuation api.AssetValuation
	var notes pgtype.Text
	var transactionID pgtype.UUID
	err := scanner.Scan(&valuation.Id, &valuation.AssetId, &valuation.ValuationDate.Time, &valuation.MarketValue, &valuation.OwnedValue, &valuation.LedgerBalanceBefore, &valuation.AdjustmentAmount, &notes, &transactionID, &valuation.CreatedAt)
	if err != nil {
		return api.AssetValuation{}, err
	}
	valuation.MarketValue = canonicalAmount(valuation.MarketValue)
	valuation.OwnedValue = canonicalAmount(valuation.OwnedValue)
	valuation.LedgerBalanceBefore = canonicalAmount(valuation.LedgerBalanceBefore)
	valuation.AdjustmentAmount = canonicalAmount(valuation.AdjustmentAmount)
	if notes.Valid {
		valuation.Notes = &notes.String
	}
	if transactionID.Valid {
		id := uuid.UUID(transactionID.Bytes)
		valuation.RevaluationTransactionId = &id
	}
	return valuation, nil
}

func validateAssetCreate(payload api.CreateAssetRequest) map[string]string {
	fields := map[string]string{}
	if len(strings.TrimSpace(payload.Name)) == 0 || len(payload.Name) > 100 {
		fields["name"] = "Asset name must contain between 1 and 100 characters."
	}
	if !payload.Type.Valid() {
		fields["type"] = "Choose an asset type."
	}
	if !payload.Currency.Valid() {
		fields["currency"] = "Select a supported currency."
	}
	if !ownershipSharePattern.MatchString(strings.TrimSpace(payload.OwnershipShare)) {
		fields["ownershipShare"] = "Enter an ownership share greater than 0 and no more than 100, with up to 2 decimal places."
	}
	validateAssetText(fields, "country", payload.Country, 80)
	validateAssetText(fields, "region", payload.Region, 100)
	validateAssetText(fields, "institution", payload.Institution, 150)
	validateAssetText(fields, "notes", payload.Notes, 1000)
	return fields
}

func validateAssetUpdate(payload api.UpdateAssetRequest) map[string]string {
	fields := map[string]string{}
	validateAssetText(fields, "name", payload.Name, 100)
	if payload.Name != nil && strings.TrimSpace(*payload.Name) == "" {
		fields["name"] = "Asset name must contain between 1 and 100 characters."
	}
	validateAssetText(fields, "country", payload.Country, 80)
	validateAssetText(fields, "region", payload.Region, 100)
	validateAssetText(fields, "institution", payload.Institution, 150)
	validateAssetText(fields, "notes", payload.Notes, 1000)
	return fields
}

func validateAssetText(fields map[string]string, field string, value *string, maximum int) {
	if value != nil && len(strings.TrimSpace(*value)) > maximum {
		fields[field] = fmt.Sprintf("This field must contain at most %d characters.", maximum)
	}
}

func nullableTrimmed(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	return &trimmed
}

func assetAccountSubtype(assetType api.AssetType) string {
	switch assetType {
	case api.REALESTATE:
		return "real_estate"
	case api.VEHICLE:
		return "vehicle"
	case api.SECURITIES:
		return "security"
	default:
		return "other"
	}
}

func canonicalAmount(value string) string {
	amount, err := money.Parse(value)
	if err != nil {
		return value
	}
	return amount.String()
}

var _ api.ServerInterface = (*Server)(nil)
