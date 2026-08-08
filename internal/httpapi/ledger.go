package httpapi

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/engus/myfinance/internal/api"
	"github.com/engus/myfinance/internal/money"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	errLedgerNotFound   = errors.New("owned ledger resource was not found")
	errLedgerConflict   = errors.New("ledger resource conflicts with the requested operation")
	errFXUnavailable    = errors.New("an FX rate is not available for this operation")
	errLedgerValidation = errors.New("ledger operation is invalid")
)

type ledgerAccount struct {
	ID           uuid.UUID
	Name         string
	Class        string
	Subtype      string
	Currency     string
	Archived     bool
	HasPostings  bool
	Balance      string
	LedgerRole   string
	CategoryID   *uuid.UUID
	CategoryName *string
}

type journalEntry struct {
	AccountID  uuid.UUID
	CategoryID *uuid.UUID
	Amount     string
	Currency   string
}

type journalSpec struct {
	Type           string
	EventDate      time.Time
	Description    *string
	IdempotencyKey uuid.UUID
	ReversesID     *uuid.UUID
	ReplacesID     *uuid.UUID
	Entries        []journalEntry
}

func (server *Server) ListAccounts(writer http.ResponseWriter, request *http.Request, params api.ListAccountsParams) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	if err := server.ensureLedger(request.Context(), authenticated.userID); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	includeArchived := params.IncludeArchived != nil && *params.IncludeArchived
	rows, err := server.pool.Query(request.Context(), `
		SELECT account.id, account.name, account.account_class, account.subtype,
		       account.currency::text, account.archived_at IS NOT NULL,
		       EXISTS (SELECT 1 FROM ledger_entries entry WHERE entry.account_id = account.id),
		       CASE WHEN account.account_class = 'LIABILITY'
		            THEN (-COALESCE(sum(entry.original_amount), 0))::text
		            ELSE COALESCE(sum(entry.original_amount), 0)::text END
		FROM ledger_accounts account
		LEFT JOIN ledger_entries entry
		  ON entry.account_id = account.id AND entry.user_id = account.user_id
		WHERE account.user_id = $1 AND account.role = 'USER'
		  AND ($2 OR account.archived_at IS NULL)
		GROUP BY account.id
		ORDER BY account.archived_at NULLS FIRST, account.created_at, account.id`, authenticated.userID, includeArchived)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer rows.Close()
	accounts := make([]api.Account, 0)
	for rows.Next() {
		var row ledgerAccount
		if err := rows.Scan(&row.ID, &row.Name, &row.Class, &row.Subtype, &row.Currency, &row.Archived, &row.HasPostings, &row.Balance); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		accounts = append(accounts, apiAccount(row))
	}
	if err := rows.Err(); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, api.AccountListResponse{Accounts: accounts})
}

func (server *Server) CreateAccount(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.CreateAccountRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter valid account details.")
		return
	}
	fields := validateAccount(payload.Name, payload.AccountClass, payload.Subtype, payload.Currency)
	if (payload.OpeningBalance == nil) != (payload.OpeningBalanceDate == nil) {
		fields["openingBalance"] = "Provide both an opening balance and its balance date."
	}
	var opening money.Amount
	if payload.OpeningBalance != nil {
		var err error
		opening, err = money.Parse(*payload.OpeningBalance)
		if err != nil {
			fields["openingBalance"] = "Enter an exact decimal with up to 8 fractional digits."
		}
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
	functionalCurrency, openingEquityID, err := ensureLedgerInfrastructure(request.Context(), tx, authenticated.userID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	accountID := uuid.New()
	_, err = tx.Exec(request.Context(), `
		INSERT INTO ledger_accounts (id, user_id, name, account_class, subtype, role, currency)
		VALUES ($1, $2, $3, $4, $5, 'USER', $6)`, accountID, authenticated.userID,
		strings.TrimSpace(payload.Name), string(payload.AccountClass), string(payload.Subtype), string(payload.Currency))
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if payload.OpeningBalance != nil && !opening.IsZero() {
		if string(payload.Currency) != functionalCurrency {
			server.writeLedgerError(writer, request, errFXUnavailable)
			return
		}
		key := uuid.New()
		if payload.IdempotencyKey != nil {
			key = *payload.IdempotencyKey
		}
		if _, _, err := postOpeningBalance(request.Context(), tx, authenticated.userID, ledgerAccount{ID: accountID, Class: string(payload.AccountClass), Currency: string(payload.Currency)}, openingEquityID, opening, payload.OpeningBalanceDate.Time, key); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
	}
	if err := tx.Commit(request.Context()); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	account, err := server.getOwnedAccount(request.Context(), authenticated.userID, accountID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusCreated, apiAccount(account))
}

func (server *Server) UpdateAccount(writer http.ResponseWriter, request *http.Request, accountID api.AccountId) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.UpdateAccountRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter valid account changes.")
		return
	}
	if payload.Name == nil && payload.Currency == nil && payload.Archived == nil {
		writeError(writer, http.StatusBadRequest, "empty_update", "Choose at least one account change.")
		return
	}
	if payload.Name != nil && (len(strings.TrimSpace(*payload.Name)) == 0 || len(*payload.Name) > 100) {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", map[string]string{"name": "Account name must contain between 1 and 100 characters."})
		return
	}
	if payload.Currency != nil && !payload.Currency.Valid() {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", map[string]string{"currency": "Select a supported currency."})
		return
	}

	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	var currentCurrency string
	var hasPostings bool
	err = tx.QueryRow(request.Context(), `
		SELECT currency::text, EXISTS (SELECT 1 FROM ledger_entries WHERE account_id = ledger_accounts.id)
		FROM ledger_accounts WHERE id = $1 AND user_id = $2 AND role = 'USER' FOR UPDATE`, accountID, authenticated.userID).Scan(&currentCurrency, &hasPostings)
	if errors.Is(err, pgx.ErrNoRows) {
		server.writeLedgerError(writer, request, errLedgerNotFound)
		return
	}
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if payload.Currency != nil && string(*payload.Currency) != currentCurrency && hasPostings {
		writeError(writer, http.StatusConflict, "account_currency_locked", "Account currency is locked after its first posting.")
		return
	}
	_, err = tx.Exec(request.Context(), `
		UPDATE ledger_accounts
		SET name = COALESCE($3, name),
		    currency = COALESCE($4, currency),
		    archived_at = CASE WHEN $5::boolean IS NULL THEN archived_at WHEN $5 THEN COALESCE(archived_at, now()) ELSE NULL END,
		    updated_at = now()
		WHERE id = $1 AND user_id = $2 AND role = 'USER'`, accountID, authenticated.userID,
		trimmedString(payload.Name), nullableCurrency(payload.Currency), payload.Archived)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if err := tx.Commit(request.Context()); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	account, err := server.getOwnedAccount(request.Context(), authenticated.userID, accountID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, apiAccount(account))
}

func (server *Server) ListCategories(writer http.ResponseWriter, request *http.Request, params api.ListCategoriesParams) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	if err := server.ensureLedger(request.Context(), authenticated.userID); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	includeArchived := params.IncludeArchived != nil && *params.IncludeArchived
	rows, err := server.pool.Query(request.Context(), `
		SELECT id, name, direction, archived_at IS NOT NULL
		FROM categories WHERE user_id = $1 AND ($2 OR archived_at IS NULL)
		ORDER BY archived_at NULLS FIRST, direction, lower(name), id`, authenticated.userID, includeArchived)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer rows.Close()
	categories := make([]api.Category, 0)
	for rows.Next() {
		var category api.Category
		var direction string
		if err := rows.Scan(&category.Id, &category.Name, &direction, &category.Archived); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		category.Direction = api.CategoryDirection(direction)
		categories = append(categories, category)
	}
	writeJSON(writer, http.StatusOK, api.CategoryListResponse{Categories: categories})
}

func (server *Server) CreateCategory(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.CreateCategoryRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter valid category details.")
		return
	}
	name := strings.TrimSpace(payload.Name)
	if len(name) == 0 || len(payload.Name) > 100 || !payload.Direction.Valid() {
		writeError(writer, http.StatusBadRequest, "validation_failed", "Enter a name and choose income or expense.")
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
	category, err := createCategoryInTx(request.Context(), tx, authenticated.userID, name, string(payload.Direction), functionalCurrency)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if err := tx.Commit(request.Context()); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusCreated, category)
}

func (server *Server) UpdateCategory(writer http.ResponseWriter, request *http.Request, categoryID api.CategoryId) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.UpdateCategoryRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter valid category changes.")
		return
	}
	if payload.Name == nil && payload.Archived == nil {
		writeError(writer, http.StatusBadRequest, "empty_update", "Choose at least one category change.")
		return
	}
	if payload.Name != nil && (len(strings.TrimSpace(*payload.Name)) == 0 || len(*payload.Name) > 100) {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", map[string]string{"name": "Category name must contain between 1 and 100 characters."})
		return
	}
	var category api.Category
	var direction string
	err := server.pool.QueryRow(request.Context(), `
		UPDATE categories
		SET name = COALESCE($3, name),
		    archived_at = CASE WHEN $4::boolean IS NULL THEN archived_at WHEN $4 THEN COALESCE(archived_at, now()) ELSE NULL END,
		    updated_at = now()
		WHERE id = $1 AND user_id = $2
		RETURNING id, name, direction, archived_at IS NOT NULL`, categoryID, authenticated.userID, trimmedString(payload.Name), payload.Archived).
		Scan(&category.Id, &category.Name, &direction, &category.Archived)
	if errors.Is(err, pgx.ErrNoRows) {
		server.writeLedgerError(writer, request, errLedgerNotFound)
		return
	}
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	category.Direction = api.CategoryDirection(direction)
	writeJSON(writer, http.StatusOK, category)
}

func (server *Server) CreateTransaction(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.CreateTransactionRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter a valid financial operation.")
		return
	}
	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	if _, _, err := ensureLedgerInfrastructure(request.Context(), tx, authenticated.userID); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	transactionID, _, err := postTypedOperation(request.Context(), tx, authenticated.userID, payload, nil)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if err := tx.Commit(request.Context()); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	transaction, err := server.getTransaction(request.Context(), authenticated.userID, transactionID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusCreated, transaction)
}

func (server *Server) ReverseTransaction(writer http.ResponseWriter, request *http.Request, transactionID api.TransactionId) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.ReversalRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter valid reversal details.")
		return
	}
	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	reversalID, err := postReversal(request.Context(), tx, authenticated.userID, transactionID, payload.IdempotencyKey, payload.Description)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if err := tx.Commit(request.Context()); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	transaction, err := server.getTransaction(request.Context(), authenticated.userID, reversalID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusCreated, transaction)
}

func (server *Server) ReplaceTransaction(writer http.ResponseWriter, request *http.Request, transactionID api.TransactionId) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.ReplacementRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter a valid corrected operation.")
		return
	}
	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	reversalID, err := postReversal(request.Context(), tx, authenticated.userID, transactionID, payload.ReversalIdempotencyKey, nil)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	replacementID, _, err := postTypedOperation(request.Context(), tx, authenticated.userID, payload.Operation, &transactionID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if err := tx.Commit(request.Context()); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	reversal, err := server.getTransaction(request.Context(), authenticated.userID, reversalID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	replacement, err := server.getTransaction(request.Context(), authenticated.userID, replacementID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusCreated, api.ReplacementResponse{Reversal: reversal, Replacement: replacement})
}

func (server *Server) ListTransactions(writer http.ResponseWriter, request *http.Request, params api.ListTransactionsParams) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	if err := server.ensureLedger(request.Context(), authenticated.userID); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	limit := 25
	if params.Limit != nil {
		limit = *params.Limit
	}
	if limit < 1 || limit > 100 {
		writeError(writer, http.StatusBadRequest, "invalid_limit", "Limit must be between 1 and 100.")
		return
	}
	var cursorDate *time.Time
	var cursorID *uuid.UUID
	if params.Cursor != nil {
		date, id, err := decodeLedgerCursor(*params.Cursor)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "invalid_cursor", "The transaction cursor is invalid.")
			return
		}
		cursorDate, cursorID = &date, &id
	}
	var from, to *time.Time
	if params.From != nil {
		from = &params.From.Time
	}
	if params.To != nil {
		to = &params.To.Time
	}
	var transactionType *string
	if params.Type != nil {
		value := string(*params.Type)
		transactionType = &value
	}
	rows, err := server.pool.Query(request.Context(), `
		SELECT transaction.id, transaction.event_date
		FROM ledger_transactions transaction
		WHERE transaction.user_id = $1 AND transaction.posted_at IS NOT NULL
		  AND ($2::date IS NULL OR transaction.event_date >= $2)
		  AND ($3::date IS NULL OR transaction.event_date <= $3)
		  AND ($4::uuid IS NULL OR EXISTS (
		      SELECT 1 FROM ledger_entries entry WHERE entry.transaction_id = transaction.id AND entry.account_id = $4))
		  AND ($5::uuid IS NULL OR EXISTS (
		      SELECT 1 FROM ledger_entries entry WHERE entry.transaction_id = transaction.id AND entry.category_id = $5))
		  AND ($6::text IS NULL OR transaction.transaction_type = $6)
		  AND ($7::date IS NULL OR (transaction.event_date, transaction.id) < ($7, $8::uuid))
		ORDER BY transaction.event_date DESC, transaction.id DESC
		LIMIT $9`, authenticated.userID, from, to, params.AccountId, params.CategoryId, transactionType, cursorDate, cursorID, limit+1)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	type cursorRow struct {
		ID   uuid.UUID
		Date time.Time
	}
	page := make([]cursorRow, 0, limit+1)
	for rows.Next() {
		var row cursorRow
		if err := rows.Scan(&row.ID, &row.Date); err != nil {
			rows.Close()
			server.writeLedgerError(writer, request, err)
			return
		}
		page = append(page, row)
	}
	rows.Close()
	hasMore := len(page) > limit
	if hasMore {
		page = page[:limit]
	}
	transactions := make([]api.Transaction, 0, len(page))
	for _, row := range page {
		transaction, err := server.getTransaction(request.Context(), authenticated.userID, row.ID)
		if err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		transactions = append(transactions, transaction)
	}
	response := api.TransactionListResponse{Transactions: transactions}
	if hasMore && len(page) > 0 {
		cursor := encodeLedgerCursor(page[len(page)-1].Date, page[len(page)-1].ID)
		response.NextCursor = &cursor
	}
	writeJSON(writer, http.StatusOK, response)
}

func (server *Server) ensureLedger(ctx context.Context, userID pgtype.UUID) error {
	var ready bool
	if err := server.pool.QueryRow(ctx, `
		SELECT EXISTS (
		           SELECT 1 FROM ledger_accounts WHERE user_id = $1 AND system_code = 'OPENING_EQUITY'
		       )
		   AND EXISTS (
		           SELECT 1 FROM categories WHERE user_id = $1 AND direction = 'INCOME' AND archived_at IS NULL
		       )
		   AND EXISTS (
		           SELECT 1 FROM categories WHERE user_id = $1 AND direction = 'EXPENSE' AND archived_at IS NULL
		       )
		   AND NOT EXISTS (
		           SELECT 1 FROM onboarding_account_setups WHERE user_id = $1 AND ledger_posted_at IS NULL
		       )
		   AND NOT EXISTS (
		           SELECT 1 FROM onboarding_recurring_income_setups WHERE user_id = $1 AND materialized_at IS NULL
		       )`, userID).Scan(&ready); err != nil {
		return err
	}
	if ready {
		return nil
	}
	tx, err := server.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	functionalCurrency, openingEquityID, err := ensureLedgerInfrastructure(ctx, tx, userID)
	if err != nil {
		return err
	}
	if err := materializeOnboardingAccount(ctx, tx, userID, functionalCurrency, openingEquityID); err != nil {
		return err
	}
	if err := materializeOnboardingRecurring(ctx, tx, userID, functionalCurrency); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func ensureLedgerInfrastructure(ctx context.Context, tx pgx.Tx, userID pgtype.UUID) (string, uuid.UUID, error) {
	var functionalCurrency string
	if err := tx.QueryRow(ctx, `SELECT functional_currency::text FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&functionalCurrency); err != nil {
		return "", uuid.Nil, err
	}
	systems := []struct{ code, name, class string }{
		{"OPENING_EQUITY", "Opening balance equity", "EQUITY"},
		{"UNREALIZED_GAIN_LOSS", "Unrealized gain / loss", "EQUITY"},
		{"OTHER_INCOME", "Other income", "INCOME"},
		{"OTHER_EXPENSE", "Other expense", "EXPENSE"},
	}
	var openingEquityID uuid.UUID
	for _, system := range systems {
		var id uuid.UUID
		err := tx.QueryRow(ctx, `
			INSERT INTO ledger_accounts (user_id, name, account_class, subtype, role, currency, system_code)
			VALUES ($1, $2, $3, CASE WHEN $3 = 'EQUITY' THEN 'equity' ELSE 'category' END, 'SYSTEM', $4, $5)
			ON CONFLICT (user_id, system_code) WHERE system_code IS NOT NULL
			DO UPDATE SET name = EXCLUDED.name
			RETURNING id`, userID, system.name, system.class, functionalCurrency, system.code).Scan(&id)
		if err != nil {
			return "", uuid.Nil, err
		}
		if system.code == "OPENING_EQUITY" {
			openingEquityID = id
		}
	}
	for _, seed := range []struct{ name, direction string }{{"General income", "INCOME"}, {"General expense", "EXPENSE"}} {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM categories WHERE user_id = $1 AND direction = $2 AND archived_at IS NULL)`, userID, seed.direction).Scan(&exists); err != nil {
			return "", uuid.Nil, err
		}
		if !exists {
			if _, err := createCategoryInTx(ctx, tx, userID, seed.name, seed.direction, functionalCurrency); err != nil {
				return "", uuid.Nil, err
			}
		}
	}
	return functionalCurrency, openingEquityID, nil
}

func materializeOnboardingAccount(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, functionalCurrency string, openingEquityID uuid.UUID) error {
	var setupID uuid.UUID
	var name, class, subtype, currency, openingValue string
	var openingDate time.Time
	var ledgerAccountID pgtype.UUID
	var postedAt pgtype.Timestamptz
	err := tx.QueryRow(ctx, `
		SELECT id, name, account_class, subtype, currency::text, opening_balance::text,
		       opening_balance_date, ledger_account_id, ledger_posted_at
		FROM onboarding_account_setups WHERE user_id = $1 FOR UPDATE`, userID).
		Scan(&setupID, &name, &class, &subtype, &currency, &openingValue, &openingDate, &ledgerAccountID, &postedAt)
	if errors.Is(err, pgx.ErrNoRows) || postedAt.Valid {
		return nil
	}
	if err != nil {
		return err
	}
	accountID := uuid.New()
	if ledgerAccountID.Valid {
		accountID = uuid.UUID(ledgerAccountID.Bytes)
	} else {
		if _, err := tx.Exec(ctx, `
			INSERT INTO ledger_accounts (id, user_id, name, account_class, subtype, role, currency)
			VALUES ($1, $2, $3, $4, $5, 'USER', $6)`, accountID, userID, name, class, subtype, currency); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE onboarding_account_setups SET ledger_account_id = $2, updated_at = now() WHERE id = $1`, setupID, accountID); err != nil {
			return err
		}
	}
	opening, err := money.Parse(openingValue)
	if err != nil {
		return err
	}
	if !opening.IsZero() {
		if currency != functionalCurrency {
			return errFXUnavailable
		}
		if _, _, err := postOpeningBalance(ctx, tx, userID, ledgerAccount{ID: accountID, Class: class, Currency: currency}, openingEquityID, opening, openingDate, setupID); err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE onboarding_account_setups SET ledger_posted_at = now(), updated_at = now() WHERE id = $1`, setupID)
	return err
}

func postOpeningBalance(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, account ledgerAccount, equityID uuid.UUID, amount money.Amount, eventDate time.Time, key uuid.UUID) (uuid.UUID, bool, error) {
	accountAmount := amount
	equityAmount := amount.Negate()
	if account.Class == "LIABILITY" {
		accountAmount, equityAmount = amount.Negate(), amount
	}
	return postJournal(ctx, tx, userID, journalSpec{
		Type: "OPENING_BALANCE", EventDate: eventDate, IdempotencyKey: key,
		Entries: []journalEntry{
			{AccountID: account.ID, Amount: accountAmount.String(), Currency: account.Currency},
			{AccountID: equityID, Amount: equityAmount.String(), Currency: account.Currency},
		},
	})
}

func postTypedOperation(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, payload api.CreateTransactionRequest, replacesID *uuid.UUID) (uuid.UUID, bool, error) {
	if !payload.Type.Valid() {
		return uuid.Nil, false, fmt.Errorf("%w: unknown operation type", errLedgerValidation)
	}
	amount, err := money.Parse(payload.Amount)
	if err != nil || !amount.IsPositive() {
		return uuid.Nil, false, fmt.Errorf("%w: amount must be greater than zero", errLedgerValidation)
	}
	if payload.Description != nil {
		trimmed := strings.TrimSpace(*payload.Description)
		if len(trimmed) == 0 || len(trimmed) > 500 {
			return uuid.Nil, false, fmt.Errorf("%w: description must contain between 1 and 500 characters", errLedgerValidation)
		}
		payload.Description = &trimmed
	}
	var functionalCurrency string
	var openingEquityID uuid.UUID
	if err := tx.QueryRow(ctx, `
		SELECT users.functional_currency::text, account.id
		FROM users JOIN ledger_accounts account ON account.user_id = users.id AND account.system_code = 'OPENING_EQUITY'
		WHERE users.id = $1 FOR UPDATE OF users`, userID).Scan(&functionalCurrency, &openingEquityID); err != nil {
		return uuid.Nil, false, err
	}
	loadAccount := func(id *uuid.UUID) (ledgerAccount, error) {
		if id == nil {
			return ledgerAccount{}, fmt.Errorf("%w: required account is missing", errLedgerValidation)
		}
		var account ledgerAccount
		var archivedAt pgtype.Timestamptz
		err := tx.QueryRow(ctx, `
			SELECT id, name, account_class, subtype, currency::text, archived_at
			FROM ledger_accounts WHERE id = $1 AND user_id = $2 AND role = 'USER' FOR UPDATE`, *id, userID).
			Scan(&account.ID, &account.Name, &account.Class, &account.Subtype, &account.Currency, &archivedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ledgerAccount{}, errLedgerNotFound
		}
		if err != nil {
			return ledgerAccount{}, err
		}
		account.Archived = archivedAt.Valid
		if account.Archived {
			return ledgerAccount{}, fmt.Errorf("%w: archived accounts cannot receive operations", errLedgerConflict)
		}
		if account.Currency != functionalCurrency {
			return ledgerAccount{}, errFXUnavailable
		}
		return account, nil
	}
	loadCategory := func(id *uuid.UUID, direction string) (ledgerAccount, error) {
		if id == nil {
			return ledgerAccount{}, fmt.Errorf("%w: required category is missing", errLedgerValidation)
		}
		var account ledgerAccount
		var categoryID uuid.UUID
		var categoryName string
		var archivedAt pgtype.Timestamptz
		err := tx.QueryRow(ctx, `
			SELECT account.id, account.name, account.account_class, account.subtype, account.currency::text,
			       category.id, category.name, category.archived_at
			FROM categories category JOIN ledger_accounts account ON account.id = category.ledger_account_id
			WHERE category.id = $1 AND category.user_id = $2 AND category.direction = $3 FOR UPDATE OF category`, *id, userID, direction).
			Scan(&account.ID, &account.Name, &account.Class, &account.Subtype, &account.Currency, &categoryID, &categoryName, &archivedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return ledgerAccount{}, errLedgerNotFound
		}
		if err != nil {
			return ledgerAccount{}, err
		}
		if archivedAt.Valid {
			return ledgerAccount{}, fmt.Errorf("%w: archived categories cannot receive operations", errLedgerConflict)
		}
		account.CategoryID, account.CategoryName = &categoryID, &categoryName
		return account, nil
	}

	entries := make([]journalEntry, 0, 2)
	switch payload.Type {
	case api.CreateTransactionRequestTypeOPENINGBALANCE:
		account, err := loadAccount(payload.AccountId)
		if err != nil {
			return uuid.Nil, false, err
		}
		accountAmount, equityAmount := amount, amount.Negate()
		if account.Class == "LIABILITY" {
			accountAmount, equityAmount = amount.Negate(), amount
		}
		entries = append(entries,
			journalEntry{AccountID: account.ID, Amount: accountAmount.String(), Currency: account.Currency},
			journalEntry{AccountID: openingEquityID, Amount: equityAmount.String(), Currency: functionalCurrency})
	case api.CreateTransactionRequestTypeINCOME:
		account, err := loadAccount(payload.AccountId)
		if err != nil {
			return uuid.Nil, false, err
		}
		if account.Class != "ASSET" {
			return uuid.Nil, false, fmt.Errorf("%w: income requires an asset account", errLedgerValidation)
		}
		category, err := loadCategory(payload.CategoryId, "INCOME")
		if err != nil {
			return uuid.Nil, false, err
		}
		entries = append(entries,
			journalEntry{AccountID: account.ID, Amount: amount.String(), Currency: account.Currency},
			journalEntry{AccountID: category.ID, CategoryID: category.CategoryID, Amount: amount.Negate().String(), Currency: functionalCurrency})
	case api.CreateTransactionRequestTypeEXPENSE:
		account, err := loadAccount(payload.AccountId)
		if err != nil {
			return uuid.Nil, false, err
		}
		if account.Class != "ASSET" {
			return uuid.Nil, false, fmt.Errorf("%w: expense requires an asset account", errLedgerValidation)
		}
		category, err := loadCategory(payload.CategoryId, "EXPENSE")
		if err != nil {
			return uuid.Nil, false, err
		}
		entries = append(entries,
			journalEntry{AccountID: account.ID, Amount: amount.Negate().String(), Currency: account.Currency},
			journalEntry{AccountID: category.ID, CategoryID: category.CategoryID, Amount: amount.String(), Currency: functionalCurrency})
	case api.CreateTransactionRequestTypeTRANSFER, api.CreateTransactionRequestTypeASSETPURCHASE:
		source, err := loadAccount(payload.SourceAccountId)
		if err != nil {
			return uuid.Nil, false, err
		}
		destination, err := loadAccount(payload.DestinationAccountId)
		if err != nil {
			return uuid.Nil, false, err
		}
		if source.ID == destination.ID {
			return uuid.Nil, false, fmt.Errorf("%w: source and destination must differ", errLedgerValidation)
		}
		if source.Class != "ASSET" || destination.Class != "ASSET" {
			return uuid.Nil, false, fmt.Errorf("%w: transfers require asset accounts", errLedgerValidation)
		}
		if source.Currency != destination.Currency {
			return uuid.Nil, false, errFXUnavailable
		}
		entries = append(entries,
			journalEntry{AccountID: source.ID, Amount: amount.Negate().String(), Currency: source.Currency},
			journalEntry{AccountID: destination.ID, Amount: amount.String(), Currency: destination.Currency})
	}
	return postJournal(ctx, tx, userID, journalSpec{
		Type: string(payload.Type), EventDate: payload.EventDate.Time, Description: payload.Description,
		IdempotencyKey: payload.IdempotencyKey, ReplacesID: replacesID, Entries: entries,
	})
}

func postJournal(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, spec journalSpec) (uuid.UUID, bool, error) {
	transactionID := uuid.New()
	err := tx.QueryRow(ctx, `
		INSERT INTO ledger_transactions (
		    id, user_id, transaction_type, event_date, description, idempotency_key,
		    reverses_transaction_id, replaces_transaction_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (user_id, idempotency_key) DO NOTHING
		RETURNING id`, transactionID, userID, spec.Type, spec.EventDate, spec.Description,
		spec.IdempotencyKey, spec.ReversesID, spec.ReplacesID).Scan(&transactionID)
	if errors.Is(err, pgx.ErrNoRows) {
		if err := tx.QueryRow(ctx, `SELECT id FROM ledger_transactions WHERE user_id = $1 AND idempotency_key = $2 AND posted_at IS NOT NULL`, userID, spec.IdempotencyKey).Scan(&transactionID); err != nil {
			return uuid.Nil, false, errLedgerConflict
		}
		return transactionID, true, nil
	}
	if err != nil {
		return uuid.Nil, false, err
	}
	if len(spec.Entries) < 2 {
		return uuid.Nil, false, fmt.Errorf("%w: journal requires two entries", errLedgerValidation)
	}
	for _, entry := range spec.Entries {
		if _, err := tx.Exec(ctx, `
			INSERT INTO ledger_entries (
			    transaction_id, user_id, account_id, category_id, original_amount, currency,
			    functional_amount, fx_rate, fx_source, fx_date)
			VALUES ($1, $2, $3, $4, $5::numeric, $6, $5::numeric, 1, 'IDENTITY', $7)`,
			transactionID, userID, entry.AccountID, entry.CategoryID, entry.Amount, entry.Currency, spec.EventDate); err != nil {
			return uuid.Nil, false, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE ledger_transactions SET posted_at = now() WHERE id = $1 AND user_id = $2 AND posted_at IS NULL`, transactionID, userID); err != nil {
		return uuid.Nil, false, err
	}
	return transactionID, false, nil
}

func postReversal(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, originalID, key uuid.UUID, description *string) (uuid.UUID, error) {
	var eventDate time.Time
	var transactionType string
	err := tx.QueryRow(ctx, `
		SELECT event_date, transaction_type FROM ledger_transactions
		WHERE id = $1 AND user_id = $2 AND posted_at IS NOT NULL FOR UPDATE`, originalID, userID).
		Scan(&eventDate, &transactionType)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, errLedgerNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	if transactionType == "REVERSAL" {
		return uuid.Nil, fmt.Errorf("%w: a reversal cannot be reversed", errLedgerConflict)
	}
	var alreadyReversed bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ledger_transactions WHERE user_id = $1 AND reverses_transaction_id = $2)`, userID, originalID).Scan(&alreadyReversed); err != nil {
		return uuid.Nil, err
	}
	if alreadyReversed {
		return uuid.Nil, fmt.Errorf("%w: transaction is already reversed", errLedgerConflict)
	}
	if description == nil {
		value := "Reversal"
		description = &value
	}
	entries := make([]journalEntry, 0, 2)
	rows, err := tx.Query(ctx, `
		SELECT account_id, category_id, (-original_amount)::text, currency::text
		FROM ledger_entries WHERE transaction_id = $1 AND user_id = $2 ORDER BY id`, originalID, userID)
	if err != nil {
		return uuid.Nil, err
	}
	for rows.Next() {
		var entry journalEntry
		var categoryID pgtype.UUID
		if err := rows.Scan(&entry.AccountID, &categoryID, &entry.Amount, &entry.Currency); err != nil {
			rows.Close()
			return uuid.Nil, err
		}
		if categoryID.Valid {
			id := uuid.UUID(categoryID.Bytes)
			entry.CategoryID = &id
		}
		entries = append(entries, entry)
	}
	rows.Close()
	reversalID, _, err := postJournal(ctx, tx, userID, journalSpec{
		Type: "REVERSAL", EventDate: eventDate, Description: description, IdempotencyKey: key,
		ReversesID: &originalID, Entries: entries,
	})
	return reversalID, err
}

func createCategoryInTx(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, name, direction, currency string) (api.Category, error) {
	ledgerAccountID, categoryID := uuid.New(), uuid.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO ledger_accounts (id, user_id, name, account_class, subtype, role, currency)
		VALUES ($1, $2, $3, $4, 'category', 'CATEGORY', $5)`, ledgerAccountID, userID, name, direction, currency); err != nil {
		return api.Category{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO categories (id, user_id, name, direction, ledger_account_id)
		VALUES ($1, $2, $3, $4, $5)`, categoryID, userID, name, direction, ledgerAccountID); err != nil {
		return api.Category{}, err
	}
	return api.Category{Id: categoryID, Name: name, Direction: api.CategoryDirection(direction), Archived: false}, nil
}

func (server *Server) getOwnedAccount(ctx context.Context, userID pgtype.UUID, accountID uuid.UUID) (ledgerAccount, error) {
	var account ledgerAccount
	err := server.pool.QueryRow(ctx, `
		SELECT account.id, account.name, account.account_class, account.subtype,
		       account.currency::text, account.archived_at IS NOT NULL,
		       EXISTS (SELECT 1 FROM ledger_entries entry WHERE entry.account_id = account.id),
		       CASE WHEN account.account_class = 'LIABILITY'
		            THEN (-COALESCE(sum(entry.original_amount), 0))::text
		            ELSE COALESCE(sum(entry.original_amount), 0)::text END
		FROM ledger_accounts account
		LEFT JOIN ledger_entries entry ON entry.account_id = account.id AND entry.user_id = account.user_id
		WHERE account.id = $1 AND account.user_id = $2 AND account.role = 'USER'
		GROUP BY account.id`, accountID, userID).
		Scan(&account.ID, &account.Name, &account.Class, &account.Subtype, &account.Currency, &account.Archived, &account.HasPostings, &account.Balance)
	if errors.Is(err, pgx.ErrNoRows) {
		return ledgerAccount{}, errLedgerNotFound
	}
	return account, err
}

func (server *Server) getTransaction(ctx context.Context, userID pgtype.UUID, transactionID uuid.UUID) (api.Transaction, error) {
	var response api.Transaction
	var transactionType string
	var status string
	var reversesID, replacesID pgtype.UUID
	err := server.pool.QueryRow(ctx, `
		SELECT transaction.id, transaction.transaction_type, transaction.event_date,
		       transaction.description, transaction.posted_at,
		       transaction.reverses_transaction_id, transaction.replaces_transaction_id,
		       CASE WHEN transaction.transaction_type = 'REVERSAL' THEN 'REVERSAL'
		            WHEN EXISTS (SELECT 1 FROM ledger_transactions replacement WHERE replacement.user_id = transaction.user_id AND replacement.replaces_transaction_id = transaction.id) THEN 'REPLACED'
		            WHEN EXISTS (SELECT 1 FROM ledger_transactions reversal WHERE reversal.user_id = transaction.user_id AND reversal.reverses_transaction_id = transaction.id) THEN 'REVERSED'
		            ELSE 'POSTED' END
		FROM ledger_transactions transaction
		WHERE transaction.id = $1 AND transaction.user_id = $2 AND transaction.posted_at IS NOT NULL`, transactionID, userID).
		Scan(&response.Id, &transactionType, &response.EventDate.Time, &response.Description, &response.PostedAt, &reversesID, &replacesID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return api.Transaction{}, errLedgerNotFound
	}
	if err != nil {
		return api.Transaction{}, err
	}
	response.Type = api.TransactionType(transactionType)
	response.Status = api.TransactionStatus(status)
	if reversesID.Valid {
		id := uuid.UUID(reversesID.Bytes)
		response.ReversesTransactionId = &id
	}
	if replacesID.Valid {
		id := uuid.UUID(replacesID.Bytes)
		response.ReplacesTransactionId = &id
	}

	rows, err := server.pool.Query(ctx, `
		SELECT account.id, account.name, account.role, entry.original_amount::text, entry.currency::text, category.id, category.name
		FROM ledger_entries entry
		JOIN ledger_accounts account ON account.id = entry.account_id
		LEFT JOIN categories category ON category.id = entry.category_id
		WHERE entry.transaction_id = $1 AND entry.user_id = $2
		ORDER BY account.role = 'USER' DESC, entry.id`, transactionID, userID)
	if err != nil {
		return api.Transaction{}, err
	}
	type displayEntry struct {
		id                           uuid.UUID
		name, role, amount, currency string
		categoryID                   *uuid.UUID
		category                     *string
	}
	userEntries := make([]displayEntry, 0, 2)
	for rows.Next() {
		var entry displayEntry
		if err := rows.Scan(&entry.id, &entry.name, &entry.role, &entry.amount, &entry.currency, &entry.categoryID, &entry.category); err != nil {
			rows.Close()
			return api.Transaction{}, err
		}
		if entry.category != nil {
			response.CategoryName = entry.category
			response.CategoryId = entry.categoryID
		}
		if entry.role == "USER" {
			userEntries = append(userEntries, entry)
		}
	}
	rows.Close()
	if len(userEntries) == 0 {
		return api.Transaction{}, errors.New("ledger transaction has no user-facing account")
	}
	primaryIndex := 0
	wantNegative := transactionType == "EXPENSE" || transactionType == "TRANSFER" || transactionType == "ASSET_PURCHASE"
	for index, entry := range userEntries {
		if strings.HasPrefix(entry.amount, "-") == wantNegative {
			primaryIndex = index
			break
		}
	}
	primary := userEntries[primaryIndex]
	response.PrimaryAccountId = &primary.id
	response.PrimaryAccountName = primary.name
	response.Currency = api.Currency(primary.currency)
	parsed, err := money.Parse(primary.amount)
	if err != nil {
		return api.Transaction{}, err
	}
	if !parsed.IsPositive() {
		parsed = parsed.Negate()
	}
	response.Amount = parsed.String()
	for index, entry := range userEntries {
		if index != primaryIndex {
			name := entry.name
			response.CounterpartyName = &name
			response.CounterpartyAccountId = &entry.id
			break
		}
	}
	return response, nil
}

func apiAccount(account ledgerAccount) api.Account {
	return api.Account{
		Id: account.ID, Name: account.Name, AccountClass: api.UserAccountClass(account.Class),
		Subtype: api.AccountSubtype(account.Subtype), Currency: api.Currency(account.Currency),
		Balance: account.Balance, Archived: account.Archived, HasPostings: account.HasPostings,
	}
}

func validateAccount(name string, class api.UserAccountClass, subtype api.AccountSubtype, currency api.Currency) map[string]string {
	fields := make(map[string]string)
	if len(strings.TrimSpace(name)) == 0 || len(name) > 100 {
		fields["name"] = "Account name must contain between 1 and 100 characters."
	}
	if !class.Valid() {
		fields["accountClass"] = "Select an account class."
	}
	if !subtype.Valid() {
		fields["subtype"] = "Select an account type."
	}
	if !currency.Valid() {
		fields["currency"] = "Select a supported currency."
	}
	liabilityType := subtype == api.AccountSubtypeLoan || subtype == api.AccountSubtypeMortgage
	if class == api.UserAccountClassASSET && liabilityType {
		fields["subtype"] = "Loan and mortgage accounts must be liabilities."
	}
	if class == api.UserAccountClassLIABILITY && !liabilityType && subtype != api.AccountSubtypeOther {
		fields["subtype"] = "Liabilities must use loan, mortgage, or other."
	}
	return fields
}

func trimmedString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	return &trimmed
}

func nullableCurrency(value *api.Currency) *string {
	if value == nil {
		return nil
	}
	result := string(*value)
	return &result
}

func encodeLedgerCursor(date time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(date.Format("2006-01-02") + "|" + id.String()))
}

func decodeLedgerCursor(cursor string) (time.Time, uuid.UUID, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	parts := strings.Split(string(decoded), "|")
	if len(parts) != 2 {
		return time.Time{}, uuid.Nil, errors.New("invalid cursor shape")
	}
	date, err := time.Parse("2006-01-02", parts[0])
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	id, err := uuid.Parse(parts[1])
	return date, id, err
}

func (server *Server) writeLedgerError(writer http.ResponseWriter, request *http.Request, err error) {
	if server.writeReconciliationError(writer, request, err) {
		return
	}
	if errors.Is(err, errLedgerNotFound) {
		writeError(writer, http.StatusNotFound, "not_found", "The requested resource was not found.")
		return
	}
	if errors.Is(err, errFXUnavailable) {
		writeError(writer, http.StatusConflict, "fx_rate_unavailable", "Different-currency operations will be available after FX rates are connected. Use matching currencies for now.")
		return
	}
	if errors.Is(err, errLedgerValidation) {
		writeError(writer, http.StatusBadRequest, "validation_failed", strings.TrimPrefix(err.Error(), errLedgerValidation.Error()+": "))
		return
	}
	if errors.Is(err, errLedgerConflict) {
		writeError(writer, http.StatusConflict, "ledger_conflict", strings.TrimPrefix(err.Error(), errLedgerConflict.Error()+": "))
		return
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "23505":
			writeError(writer, http.StatusConflict, "duplicate_resource", "A matching active resource already exists.")
			return
		case "40001":
			writeError(writer, http.StatusConflict, "concurrent_change", "Financial data changed concurrently. Review it and try again.")
			return
		case "55000":
			writeError(writer, http.StatusConflict, "immutable_ledger", postgresError.Message)
			return
		}
	}
	Logger(request.Context()).Error("ledger_request_failed", "error", err)
	writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
}
