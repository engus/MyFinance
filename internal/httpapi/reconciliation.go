package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/engus/myfinance/internal/api"
	"github.com/engus/myfinance/internal/money"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

var (
	errReconciliationStale = errors.New("reconciliation preview is stale")
	errPreviewExpired      = errors.New("reconciliation preview has expired")
)

type reconciliationAccount struct {
	ID       uuid.UUID
	Name     string
	Currency string
}

type reconciliationRow struct {
	ID, AccountID                                                uuid.UUID
	AccountName, Currency                                        string
	PeriodEnd                                                    time.Time
	Reported, LedgerBefore, Difference, Adjustment               string
	AdjustmentTransactionID, ReversalTransactionID, SupersedesID *uuid.UUID
	GapStart                                                     *time.Time
	GapMonths                                                    int
	CreatedAt                                                    time.Time
}

type reconciliationPreviewRow struct {
	ID, AccountID, IdempotencyKey uuid.UUID
	AccountName, Currency         string
	PeriodEnd                     time.Time
	Reported, Ledger, Difference  string
	CurrentReconciliationID       *uuid.UUID
	ConfirmedReconciliationID     *uuid.UUID
	ExpiresAt                     time.Time
	GapMonths                     int
}

func (server *Server) GetReconciliationStatus(writer http.ResponseWriter, request *http.Request, params api.GetReconciliationStatusParams) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	if err := server.ensureLedger(request.Context(), authenticated.userID); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	var timezone string
	if err := server.pool.QueryRow(request.Context(), `SELECT timezone FROM users WHERE id = $1`, authenticated.userID).Scan(&timezone); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	localNow := time.Now().In(location)
	today := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, time.UTC)
	suggested, _, _, _ := reconciliationWindow(today)
	periodEnd := suggested
	if params.PeriodEnd != nil {
		periodEnd = dateOnly(params.PeriodEnd.Time)
	}
	if err := validateReconciliationPeriod(today, periodEnd); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	_, promptStart, promptEnd, promptOpen := reconciliationWindowForPeriod(today, periodEnd)

	rows, err := server.pool.Query(request.Context(), `
		SELECT account.id, account.name, account.currency::text,
		       COALESCE((
		           SELECT sum(entry.original_amount)::text
		           FROM ledger_entries entry
		           JOIN ledger_transactions transaction ON transaction.id = entry.transaction_id
		           WHERE entry.user_id = account.user_id AND entry.account_id = account.id
		             AND transaction.posted_at IS NOT NULL AND transaction.event_date <= $2
		       ), '0'),
		       reconciliation.id, reconciliation.reported_balance::text,
		       reconciliation.net_difference::text,
		       previous.period_end
		FROM ledger_accounts account
		LEFT JOIN reconciliations reconciliation
		  ON reconciliation.user_id = account.user_id AND reconciliation.account_id = account.id
		 AND reconciliation.period_end = $2 AND reconciliation.superseded_at IS NULL
		LEFT JOIN LATERAL (
		    SELECT period_end FROM reconciliations history
		    WHERE history.user_id = account.user_id AND history.account_id = account.id
		      AND history.period_end < $2 AND history.superseded_at IS NULL
		    ORDER BY period_end DESC LIMIT 1
		) previous ON true
		WHERE account.user_id = $1 AND account.role = 'USER' AND account.account_class = 'ASSET'
		  AND account.subtype IN ('bank', 'cash') AND account.archived_at IS NULL
		ORDER BY account.created_at, account.id`, authenticated.userID, periodEnd)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer rows.Close()
	accounts := make([]api.AccountReconciliationStatus, 0)
	complete := true
	for rows.Next() {
		var account api.AccountReconciliationStatus
		var reconciliationID pgtype.UUID
		var reported, difference pgtype.Text
		var previousPeriod pgtype.Date
		if err := rows.Scan(&account.AccountId, &account.AccountName, &account.Currency,
			&account.LedgerBalance, &reconciliationID, &reported, &difference, &previousPeriod); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		account.Status = api.PENDING
		account.GapMonths = reconciliationGapMonths(dateValuePointer(previousPeriod), periodEnd)
		account.MultiMonthGap = account.GapMonths > 1
		if previousPeriod.Valid {
			value := openapi_types.Date{Time: previousPeriod.Time}
			account.LastReconciledPeriodEnd = &value
		}
		if reconciliationID.Valid {
			id := uuid.UUID(reconciliationID.Bytes)
			account.ReconciliationId = &id
			account.Status = api.RECONCILED
			account.ReportedBalance = textPointer(reported)
			account.Difference = textPointer(difference)
		} else {
			complete = false
		}
		accounts = append(accounts, account)
	}
	if err := rows.Err(); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if len(accounts) == 0 {
		complete = false
	}
	writeJSON(writer, http.StatusOK, api.ReconciliationStatus{
		Today: openapi_types.Date{Time: today}, SuggestedPeriodEnd: openapi_types.Date{Time: suggested},
		PeriodEnd: openapi_types.Date{Time: periodEnd}, PromptStart: openapi_types.Date{Time: promptStart},
		PromptEnd: openapi_types.Date{Time: promptEnd}, PromptOpen: promptOpen, Complete: complete, Accounts: accounts,
	})
}

func (server *Server) PrepareReconciliation(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.PrepareReconciliationRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter a valid account balance.")
		return
	}
	reported, err := money.Parse(payload.ReportedBalance)
	if err != nil {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", map[string]string{"reportedBalance": "Enter an exact balance with up to 8 decimal places."})
		return
	}

	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	var mode, timezone, functionalCurrency string
	if err := tx.QueryRow(request.Context(), `SELECT reconciliation_mode, timezone, functional_currency::text FROM users WHERE id = $1 FOR UPDATE`, authenticated.userID).
		Scan(&mode, &timezone, &functionalCurrency); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	now := time.Now()
	localNow := now.In(location)
	today := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, time.UTC)
	periodEnd := dateOnly(payload.PeriodEnd.Time)
	if err := validateReconciliationPeriod(today, periodEnd); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}

	if existing, found, err := reconciliationByIdempotency(request.Context(), tx, authenticated.userID, payload.IdempotencyKey); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	} else if found {
		if err := tx.Commit(request.Context()); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		writeJSON(writer, http.StatusOK, api.ReconciliationSubmissionResponse{Outcome: api.APPLIED, Reconciliation: pointer(apiReconciliation(existing))})
		return
	}
	if existing, found, err := previewByIdempotency(request.Context(), tx, authenticated.userID, payload.IdempotencyKey); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	} else if found {
		if err := tx.Commit(request.Context()); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		writeJSON(writer, http.StatusOK, api.ReconciliationSubmissionResponse{Outcome: api.PREVIEW, Preview: pointer(apiReconciliationPreview(existing))})
		return
	}

	account, err := lockReconciliationAccount(request.Context(), tx, authenticated.userID, payload.AccountId)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if account.Currency != functionalCurrency {
		server.writeLedgerError(writer, request, errFXUnavailable)
		return
	}
	ledgerBalance, err := accountBalanceAt(request.Context(), tx, authenticated.userID, account.ID, periodEnd)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	currentID, err := activeReconciliationID(request.Context(), tx, authenticated.userID, account.ID, periodEnd)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	difference := reported.Add(ledgerBalance.Negate())
	previousPeriod, err := previousReconciliationPeriod(request.Context(), tx, authenticated.userID, account.ID, periodEnd)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	gapMonths := reconciliationGapMonths(previousPeriod, periodEnd)

	if mode == string(api.AUTO) {
		reconciliation, err := applyReconciliation(request.Context(), tx, authenticated.userID, account, periodEnd, reported, ledgerBalance, currentID, payload.IdempotencyKey, gapMonths)
		if err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		if err := tx.Commit(request.Context()); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		writeJSON(writer, http.StatusOK, api.ReconciliationSubmissionResponse{Outcome: api.APPLIED, Reconciliation: pointer(apiReconciliation(reconciliation))})
		return
	}

	previewID := uuid.New()
	expiresAt := now.Add(15 * time.Minute)
	_, err = tx.Exec(request.Context(), `
		INSERT INTO reconciliation_previews (
		    id, user_id, account_id, period_end, reported_balance, ledger_balance,
		    net_difference, idempotency_key, current_reconciliation_id, expires_at)
		VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9, $10)`,
		previewID, authenticated.userID, account.ID, periodEnd, reported.String(), ledgerBalance.String(),
		difference.String(), payload.IdempotencyKey, currentID, expiresAt)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if err := tx.Commit(request.Context()); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	preview := reconciliationPreviewRow{
		ID: previewID, AccountID: account.ID, IdempotencyKey: payload.IdempotencyKey,
		AccountName: account.Name, Currency: account.Currency, PeriodEnd: periodEnd,
		Reported: reported.String(), Ledger: ledgerBalance.String(), Difference: difference.String(),
		CurrentReconciliationID: currentID, ExpiresAt: expiresAt, GapMonths: gapMonths,
	}
	writeJSON(writer, http.StatusOK, api.ReconciliationSubmissionResponse{Outcome: api.PREVIEW, Preview: pointer(apiReconciliationPreview(preview))})
}

func (server *Server) ConfirmReconciliation(writer http.ResponseWriter, request *http.Request, previewID api.PreviewId) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	preview, err := lockReconciliationPreview(request.Context(), tx, authenticated.userID, previewID)
	if errors.Is(err, pgx.ErrNoRows) {
		server.writeLedgerError(writer, request, errLedgerNotFound)
		return
	}
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if preview.ConfirmedReconciliationID != nil {
		reconciliation, err := reconciliationByID(request.Context(), tx, authenticated.userID, *preview.ConfirmedReconciliationID)
		if err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		if err := tx.Commit(request.Context()); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		writeJSON(writer, http.StatusCreated, apiReconciliation(reconciliation))
		return
	}
	if time.Now().After(preview.ExpiresAt) {
		server.writeLedgerError(writer, request, errPreviewExpired)
		return
	}
	account, err := lockReconciliationAccount(request.Context(), tx, authenticated.userID, preview.AccountID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	currentBalance, err := accountBalanceAt(request.Context(), tx, authenticated.userID, account.ID, preview.PeriodEnd)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	currentID, err := activeReconciliationID(request.Context(), tx, authenticated.userID, account.ID, preview.PeriodEnd)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if !amountStringsEqual(currentBalance.String(), preview.Ledger) || !uuidPointersEqual(currentID, preview.CurrentReconciliationID) {
		server.writeLedgerError(writer, request, errReconciliationStale)
		return
	}
	reported, _ := money.Parse(preview.Reported)
	reconciliation, err := applyReconciliation(request.Context(), tx, authenticated.userID, account, preview.PeriodEnd, reported, currentBalance, currentID, preview.IdempotencyKey, preview.GapMonths)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	_, err = tx.Exec(request.Context(), `
		UPDATE reconciliation_previews SET confirmed_reconciliation_id = $3, confirmed_at = now()
		WHERE id = $1 AND user_id = $2`, preview.ID, authenticated.userID, reconciliation.ID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if err := tx.Commit(request.Context()); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusCreated, apiReconciliation(reconciliation))
}

func applyReconciliation(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, account reconciliationAccount, periodEnd time.Time, reported, currentBalance money.Amount, currentID *uuid.UUID, idempotencyKey uuid.UUID, gapMonths int) (reconciliationRow, error) {
	if existing, found, err := reconciliationByIdempotency(ctx, tx, userID, idempotencyKey); err != nil || found {
		return existing, err
	}
	var reversalID *uuid.UUID
	baseBalance := currentBalance
	if currentID != nil {
		var adjustmentID pgtype.UUID
		if err := tx.QueryRow(ctx, `
			SELECT adjustment_transaction_id FROM reconciliations
			WHERE id = $1 AND user_id = $2 AND superseded_at IS NULL FOR UPDATE`, *currentID, userID).Scan(&adjustmentID); err != nil {
			return reconciliationRow{}, errReconciliationStale
		}
		if adjustmentID.Valid {
			key := uuid.NewSHA1(uuid.NameSpaceOID, []byte("reconciliation-reversal|"+currentID.String()+"|"+idempotencyKey.String()))
			description := "Replace reconciliation"
			id, err := postReversal(ctx, tx, userID, uuid.UUID(adjustmentID.Bytes), key, &description)
			if err != nil {
				return reconciliationRow{}, err
			}
			reversalID = &id
			baseBalance, err = accountBalanceAt(ctx, tx, userID, account.ID, periodEnd)
			if err != nil {
				return reconciliationRow{}, err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE reconciliations SET superseded_at = now() WHERE id = $1 AND user_id = $2 AND superseded_at IS NULL`, *currentID, userID); err != nil {
			return reconciliationRow{}, err
		}
	}
	adjustment := reported.Add(baseBalance.Negate())
	netDifference := reported.Add(currentBalance.Negate())
	var adjustmentTransactionID *uuid.UUID
	if !adjustment.IsZero() {
		systemCode := "OTHER_INCOME"
		if !adjustment.IsPositive() {
			systemCode = "OTHER_EXPENSE"
		}
		var systemAccountID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id FROM ledger_accounts WHERE user_id = $1 AND system_code = $2`, userID, systemCode).Scan(&systemAccountID); err != nil {
			return reconciliationRow{}, err
		}
		description := "Reconcile " + account.Name + " · " + periodEnd.Format("2006-01")
		if gapMonths > 1 {
			description += fmt.Sprintf(" · %d-month gap", gapMonths)
		}
		transactionID, _, err := postJournal(ctx, tx, userID, journalSpec{
			Type: "RECONCILIATION", EventDate: periodEnd, Description: &description, IdempotencyKey: idempotencyKey,
			Entries: []journalEntry{
				{AccountID: account.ID, Amount: adjustment.String(), Currency: account.Currency},
				{AccountID: systemAccountID, Amount: adjustment.Negate().String(), Currency: account.Currency},
			},
		})
		if err != nil {
			return reconciliationRow{}, err
		}
		adjustmentTransactionID = &transactionID
	}
	reconciliationID := uuid.New()
	var gapStart *time.Time
	if gapMonths > 1 {
		value := addMonthsClamped(periodEnd, -(gapMonths - 1))
		gapStart = &value
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO reconciliations (
		    id, user_id, account_id, period_end, reported_balance, ledger_balance_before,
		    net_difference, adjustment_amount, adjustment_transaction_id, reversal_transaction_id,
		    supersedes_reconciliation_id, gap_start_period_end, gap_months, idempotency_key)
		VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9, $10, $11, $12, $13, $14)`,
		reconciliationID, userID, account.ID, periodEnd, reported.String(), currentBalance.String(),
		netDifference.String(), adjustment.String(), adjustmentTransactionID, reversalID, currentID, gapStart, gapMonths, idempotencyKey)
	if err != nil {
		return reconciliationRow{}, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO balance_snapshots (user_id, account_id, reconciliation_id, period_end, reported_balance, currency)
		VALUES ($1, $2, $3, $4, $5::numeric, $6)`, userID, account.ID, reconciliationID, periodEnd, reported.String(), account.Currency)
	if err != nil {
		return reconciliationRow{}, err
	}
	return reconciliationRow{
		ID: reconciliationID, AccountID: account.ID, AccountName: account.Name, Currency: account.Currency,
		PeriodEnd: periodEnd, Reported: reported.String(), LedgerBefore: currentBalance.String(),
		Difference: netDifference.String(), Adjustment: adjustment.String(),
		AdjustmentTransactionID: adjustmentTransactionID, ReversalTransactionID: reversalID,
		SupersedesID: currentID, GapStart: gapStart, GapMonths: gapMonths, CreatedAt: time.Now().UTC(),
	}, nil
}

func lockReconciliationAccount(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, accountID uuid.UUID) (reconciliationAccount, error) {
	var account reconciliationAccount
	err := tx.QueryRow(ctx, `
		SELECT id, name, currency::text FROM ledger_accounts
		WHERE id = $1 AND user_id = $2 AND role = 'USER' AND account_class = 'ASSET'
		  AND subtype IN ('bank', 'cash') AND archived_at IS NULL FOR UPDATE`, accountID, userID).
		Scan(&account.ID, &account.Name, &account.Currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return reconciliationAccount{}, errLedgerNotFound
	}
	return account, err
}

func accountBalanceAt(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, accountID uuid.UUID, periodEnd time.Time) (money.Amount, error) {
	var value string
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(sum(entry.original_amount), 0)::text
		FROM ledger_entries entry
		JOIN ledger_transactions transaction ON transaction.id = entry.transaction_id
		WHERE entry.user_id = $1 AND entry.account_id = $2
		  AND transaction.posted_at IS NOT NULL AND transaction.event_date <= $3`, userID, accountID, periodEnd).Scan(&value)
	if err != nil {
		return money.Amount{}, err
	}
	return money.Parse(value)
}

func activeReconciliationID(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, accountID uuid.UUID, periodEnd time.Time) (*uuid.UUID, error) {
	var value pgtype.UUID
	err := tx.QueryRow(ctx, `
		SELECT id FROM reconciliations
		WHERE user_id = $1 AND account_id = $2 AND period_end = $3 AND superseded_at IS NULL`, userID, accountID, periodEnd).Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return uuidPointer(value), err
}

func previousReconciliationPeriod(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, accountID uuid.UUID, periodEnd time.Time) (*time.Time, error) {
	var value pgtype.Date
	err := tx.QueryRow(ctx, `
		SELECT period_end FROM reconciliations
		WHERE user_id = $1 AND account_id = $2 AND period_end < $3 AND superseded_at IS NULL
		ORDER BY period_end DESC LIMIT 1`, userID, accountID, periodEnd).Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return dateValuePointer(value), err
}

func reconciliationByIdempotency(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, key uuid.UUID) (reconciliationRow, bool, error) {
	row, err := scanReconciliation(tx.QueryRow(ctx, reconciliationSelect+` WHERE reconciliation.user_id = $1 AND reconciliation.idempotency_key = $2`, userID, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return reconciliationRow{}, false, nil
	}
	return row, err == nil, err
}

func reconciliationByID(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, id uuid.UUID) (reconciliationRow, error) {
	row, err := scanReconciliation(tx.QueryRow(ctx, reconciliationSelect+` WHERE reconciliation.user_id = $1 AND reconciliation.id = $2`, userID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return reconciliationRow{}, errLedgerNotFound
	}
	return row, err
}

const reconciliationSelect = `
	SELECT reconciliation.id, reconciliation.account_id, account.name, account.currency::text,
	       reconciliation.period_end, reconciliation.reported_balance::text,
	       reconciliation.ledger_balance_before::text, reconciliation.net_difference::text,
	       reconciliation.adjustment_amount::text, reconciliation.adjustment_transaction_id,
	       reconciliation.reversal_transaction_id, reconciliation.supersedes_reconciliation_id,
	       reconciliation.gap_start_period_end, reconciliation.gap_months, reconciliation.created_at
	FROM reconciliations reconciliation
	JOIN ledger_accounts account ON account.id = reconciliation.account_id`

func scanReconciliation(scanner rowScanner) (reconciliationRow, error) {
	var row reconciliationRow
	var adjustmentID, reversalID, supersedesID pgtype.UUID
	var gapStart pgtype.Date
	err := scanner.Scan(&row.ID, &row.AccountID, &row.AccountName, &row.Currency, &row.PeriodEnd,
		&row.Reported, &row.LedgerBefore, &row.Difference, &row.Adjustment,
		&adjustmentID, &reversalID, &supersedesID, &gapStart, &row.GapMonths, &row.CreatedAt)
	row.AdjustmentTransactionID = uuidPointer(adjustmentID)
	row.ReversalTransactionID = uuidPointer(reversalID)
	row.SupersedesID = uuidPointer(supersedesID)
	row.GapStart = dateValuePointer(gapStart)
	return row, err
}

func previewByIdempotency(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, key uuid.UUID) (reconciliationPreviewRow, bool, error) {
	row, err := scanReconciliationPreview(tx.QueryRow(ctx, reconciliationPreviewSelect+` WHERE preview.user_id = $1 AND preview.idempotency_key = $2`, userID, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return reconciliationPreviewRow{}, false, nil
	}
	return row, err == nil, err
}

func lockReconciliationPreview(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, previewID uuid.UUID) (reconciliationPreviewRow, error) {
	return scanReconciliationPreview(tx.QueryRow(ctx, reconciliationPreviewSelect+` WHERE preview.user_id = $1 AND preview.id = $2 FOR UPDATE OF preview`, userID, previewID))
}

const reconciliationPreviewSelect = `
	SELECT preview.id, preview.account_id, account.name, account.currency::text,
	       preview.period_end, preview.reported_balance::text, preview.ledger_balance::text,
	       preview.net_difference::text, preview.idempotency_key, preview.current_reconciliation_id,
	       preview.confirmed_reconciliation_id, preview.expires_at,
	       COALESCE((
	           SELECT GREATEST(1,
	               (extract(year FROM age(preview.period_end, max(history.period_end)))::int * 12)
	               + extract(month FROM age(preview.period_end, max(history.period_end)))::int)
	           FROM reconciliations history
	           WHERE history.user_id = preview.user_id AND history.account_id = preview.account_id
	             AND history.period_end < preview.period_end AND history.superseded_at IS NULL
	       ), 1)
	FROM reconciliation_previews preview
	JOIN ledger_accounts account ON account.id = preview.account_id`

func scanReconciliationPreview(scanner rowScanner) (reconciliationPreviewRow, error) {
	var row reconciliationPreviewRow
	var currentID, confirmedID pgtype.UUID
	err := scanner.Scan(&row.ID, &row.AccountID, &row.AccountName, &row.Currency, &row.PeriodEnd,
		&row.Reported, &row.Ledger, &row.Difference, &row.IdempotencyKey,
		&currentID, &confirmedID, &row.ExpiresAt, &row.GapMonths)
	row.CurrentReconciliationID = uuidPointer(currentID)
	row.ConfirmedReconciliationID = uuidPointer(confirmedID)
	return row, err
}

func apiReconciliationPreview(row reconciliationPreviewRow) api.ReconciliationPreview {
	direction := api.NONE
	difference, err := money.Parse(row.Difference)
	if err == nil && difference.IsPositive() {
		direction = api.OTHERINCOME
	} else if err == nil && !difference.IsZero() {
		direction = api.OTHEREXPENSE
	}
	return api.ReconciliationPreview{
		Id: row.ID, AccountId: row.AccountID, AccountName: row.AccountName, Currency: api.Currency(row.Currency),
		PeriodEnd: openapi_types.Date{Time: row.PeriodEnd}, ReportedBalance: row.Reported,
		LedgerBalance: row.Ledger, Difference: row.Difference, Direction: direction,
		GapMonths: row.GapMonths, MultiMonthGap: row.GapMonths > 1, ExpiresAt: row.ExpiresAt,
	}
}

func apiReconciliation(row reconciliationRow) api.Reconciliation {
	result := api.Reconciliation{
		Id: row.ID, AccountId: row.AccountID, AccountName: row.AccountName, Currency: api.Currency(row.Currency),
		PeriodEnd: openapi_types.Date{Time: row.PeriodEnd}, ReportedBalance: row.Reported,
		LedgerBalanceBefore: row.LedgerBefore, Difference: row.Difference, AdjustmentAmount: row.Adjustment,
		AdjustmentTransactionId: row.AdjustmentTransactionID, ReversalTransactionId: row.ReversalTransactionID,
		SupersedesReconciliationId: row.SupersedesID, GapMonths: row.GapMonths,
		MultiMonthGap: row.GapMonths > 1, CreatedAt: row.CreatedAt,
	}
	if row.GapStart != nil {
		value := openapi_types.Date{Time: *row.GapStart}
		result.GapStartPeriodEnd = &value
	}
	return result
}

func reconciliationWindow(today time.Time) (periodEnd, promptStart, promptEnd time.Time, open bool) {
	currentEnd := monthEnd(today)
	if today.Day() <= 5 {
		periodEnd = monthEnd(today.AddDate(0, -1, 0))
	} else if !today.Before(currentEnd.AddDate(0, 0, -5)) {
		periodEnd = currentEnd
	} else {
		periodEnd = monthEnd(today.AddDate(0, -1, 0))
	}
	_, promptStart, promptEnd, open = reconciliationWindowForPeriod(today, periodEnd)
	return
}

func reconciliationWindowForPeriod(today, periodEnd time.Time) (time.Time, time.Time, time.Time, bool) {
	periodEnd = monthEnd(periodEnd)
	promptStart := periodEnd.AddDate(0, 0, -5)
	nextMonth := periodEnd.AddDate(0, 0, 1)
	promptEnd := time.Date(nextMonth.Year(), nextMonth.Month(), 5, 0, 0, 0, 0, time.UTC)
	open := !today.Before(promptStart) && !today.After(promptEnd)
	return periodEnd, promptStart, promptEnd, open
}

func monthEnd(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month()+1, 0, 0, 0, 0, 0, time.UTC)
}

func validateReconciliationPeriod(today, periodEnd time.Time) error {
	periodEnd = dateOnly(periodEnd)
	if !periodEnd.Equal(monthEnd(periodEnd)) {
		return fmt.Errorf("%w: reconciliation date must be the final day of a month", errLedgerValidation)
	}
	if periodEnd.After(monthEnd(today)) {
		return fmt.Errorf("%w: a future month cannot be reconciled", errLedgerValidation)
	}
	return nil
}

func reconciliationGapMonths(previous *time.Time, periodEnd time.Time) int {
	if previous == nil {
		return 1
	}
	months := (periodEnd.Year()-previous.Year())*12 + int(periodEnd.Month()-previous.Month())
	if months < 1 {
		return 1
	}
	return months
}

func amountStringsEqual(left, right string) bool {
	a, errA := money.Parse(left)
	b, errB := money.Parse(right)
	return errA == nil && errB == nil && a.String() == b.String()
}

func uuidPointersEqual(left, right *uuid.UUID) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func pointer[T any](value T) *T {
	return &value
}

func (server *Server) writeReconciliationError(writer http.ResponseWriter, request *http.Request, err error) bool {
	if errors.Is(err, errReconciliationStale) {
		writeError(writer, http.StatusConflict, "preview_stale", "Financial data changed after this preview. Review the refreshed balance and try again.")
		return true
	}
	if errors.Is(err, errPreviewExpired) {
		writeError(writer, http.StatusConflict, "preview_expired", "This preview expired. Create a new reconciliation preview.")
		return true
	}
	return false
}
