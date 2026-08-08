package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/engus/myfinance/internal/api"
	"github.com/engus/myfinance/internal/money"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

const recurringWorkerLock int64 = 774936284041

type recurringTemplateRow struct {
	ID, UserID                                                   uuid.UUID
	Name, OperationType, Amount, Currency                        string
	Description                                                  *string
	AccountID, CategoryID, SourceAccountID, DestinationAccountID *uuid.UUID
	AccountName, CategoryName, SourceName, DestinationName       *string
	Frequency, IntervalUnit                                      string
	IntervalCount                                                int
	StartDate, NextDate                                          time.Time
	EndDate, LastGeneratedDate                                   *time.Time
	Status                                                       string
	PauseReason                                                  *string
	Archived                                                     bool
	Timezone                                                     string
}

type recurringSchedule struct {
	frequency string
	unit      string
	count     int
	start     time.Time
	end       *time.Time
}

type RecurringGenerationResult struct {
	Generated int
	Locked    bool
}

func (server *Server) ListRecurringTemplates(writer http.ResponseWriter, request *http.Request, params api.ListRecurringTemplatesParams) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	if err := server.ensureLedger(request.Context(), authenticated.userID); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	includeArchived := params.IncludeArchived != nil && *params.IncludeArchived
	rows, err := server.pool.Query(request.Context(), recurringTemplateSelect+`
		WHERE template.user_id = $1 AND ($2 OR template.archived_at IS NULL)
		ORDER BY template.archived_at NULLS FIRST, template.next_scheduled_date, lower(template.name), template.id`, authenticated.userID, includeArchived)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer rows.Close()
	templates := make([]api.RecurringTemplate, 0)
	for rows.Next() {
		row, err := scanRecurringTemplate(rows)
		if err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
		templates = append(templates, apiRecurringTemplate(row))
	}
	if err := rows.Err(); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, api.RecurringTemplateListResponse{Templates: templates})
}

func (server *Server) CreateRecurringTemplate(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.CreateRecurringTemplateRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter a valid recurring operation.")
		return
	}
	schedule, err := normalizeRecurringSchedule(payload.Frequency, payload.IntervalUnit, payload.IntervalCount, payload.StartDate.Time, datePointer(payload.EndDate))
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	amount, err := money.Parse(payload.Amount)
	if err != nil || !amount.IsPositive() {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", map[string]string{"amount": "Enter an amount greater than zero with up to 8 decimal places."})
		return
	}
	name := strings.TrimSpace(payload.Name)
	if len(name) == 0 || len(name) > 100 || !payload.Type.Valid() {
		writeError(writer, http.StatusBadRequest, "validation_failed", "Enter a name and choose an operation type.")
		return
	}
	description, err := optionalDescription(payload.Description)
	if err != nil {
		server.writeLedgerError(writer, request, err)
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
	currency, err := validateRecurringDependencies(request.Context(), tx, authenticated.userID, string(payload.Type), payload.AccountId, payload.CategoryId, payload.SourceAccountId, payload.DestinationAccountId)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	templateID := uuid.New()
	_, err = tx.Exec(request.Context(), `
		INSERT INTO recurring_templates (
		    id, user_id, name, operation_type, amount, currency, description,
		    account_id, category_id, source_account_id, destination_account_id,
		    frequency, interval_unit, interval_count, start_date, next_scheduled_date, end_date)
		VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $16)`,
		templateID, authenticated.userID, name, string(payload.Type), amount.String(), currency, description,
		payload.AccountId, payload.CategoryId, payload.SourceAccountId, payload.DestinationAccountId,
		schedule.frequency, schedule.unit, schedule.count, schedule.start, schedule.end)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if err := tx.Commit(request.Context()); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	template, err := server.getRecurringTemplate(request.Context(), authenticated.userID, templateID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusCreated, apiRecurringTemplate(template))
}

func (server *Server) UpdateRecurringTemplate(writer http.ResponseWriter, request *http.Request, templateID api.TemplateId) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.UpdateRecurringTemplateRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter valid recurring-template changes.")
		return
	}
	if payload.Name == nil && payload.Amount == nil && payload.Description == nil && payload.EndDate == nil && payload.Status == nil && payload.Archived == nil {
		writeError(writer, http.StatusBadRequest, "empty_update", "Choose at least one recurring-template change.")
		return
	}
	var amount *string
	if payload.Amount != nil {
		parsed, err := money.Parse(*payload.Amount)
		if err != nil || !parsed.IsPositive() {
			writeError(writer, http.StatusBadRequest, "validation_failed", "Amount must be greater than zero.")
			return
		}
		value := parsed.String()
		amount = &value
	}
	if payload.Name != nil && (len(strings.TrimSpace(*payload.Name)) == 0 || len(*payload.Name) > 100) {
		writeError(writer, http.StatusBadRequest, "validation_failed", "Template name must contain between 1 and 100 characters.")
		return
	}
	description, err := optionalDescription(payload.Description)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if payload.Status != nil && !payload.Status.Valid() {
		writeError(writer, http.StatusBadRequest, "validation_failed", "Choose an active or paused status.")
		return
	}

	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	var operationType string
	var accountID, categoryID, sourceID, destinationID pgtype.UUID
	var startDate, nextDate time.Time
	var currentlyArchived bool
	err = tx.QueryRow(request.Context(), `
		SELECT operation_type, account_id, category_id, source_account_id, destination_account_id,
		       start_date, next_scheduled_date, archived_at IS NOT NULL
		FROM recurring_templates WHERE id = $1 AND user_id = $2 FOR UPDATE`, templateID, authenticated.userID).
		Scan(&operationType, &accountID, &categoryID, &sourceID, &destinationID, &startDate, &nextDate, &currentlyArchived)
	if errors.Is(err, pgx.ErrNoRows) {
		server.writeLedgerError(writer, request, errLedgerNotFound)
		return
	}
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if payload.EndDate != nil && payload.EndDate.Time.Before(startDate) {
		writeError(writer, http.StatusBadRequest, "validation_failed", "End date cannot be before the start date.")
		return
	}
	if payload.Status != nil && *payload.Status == api.ACTIVE {
		if (payload.Archived != nil && *payload.Archived) || (currentlyArchived && (payload.Archived == nil || *payload.Archived)) {
			writeError(writer, http.StatusConflict, "template_archived", "Restore the template before resuming it.")
			return
		}
		if payload.EndDate != nil && nextDate.After(payload.EndDate.Time) {
			writeError(writer, http.StatusConflict, "template_completed", "Move the end date beyond the next scheduled date before resuming.")
			return
		}
		if _, err := validateRecurringDependencies(request.Context(), tx, authenticated.userID, operationType, uuidPointer(accountID), uuidPointer(categoryID), uuidPointer(sourceID), uuidPointer(destinationID)); err != nil {
			server.writeLedgerError(writer, request, err)
			return
		}
	}
	status := stringPointerEnum(payload.Status)
	_, err = tx.Exec(request.Context(), `
		UPDATE recurring_templates
		SET name = COALESCE($3, name),
		    amount = COALESCE($4::numeric, amount),
		    description = COALESCE($5, description),
		    end_date = COALESCE($6, end_date),
		    status = CASE WHEN $7::boolean IS TRUE THEN 'PAUSED' ELSE COALESCE($8, status) END,
		    pause_reason = CASE
		        WHEN $7::boolean IS TRUE THEN 'ARCHIVED'
		        WHEN $8 = 'ACTIVE' THEN NULL
		        WHEN $8 = 'PAUSED' THEN 'USER'
		        ELSE pause_reason END,
		    archived_at = CASE WHEN $7::boolean IS NULL THEN archived_at WHEN $7 THEN COALESCE(archived_at, now()) ELSE NULL END,
		    updated_at = now()
		WHERE id = $1 AND user_id = $2`, templateID, authenticated.userID, trimmedString(payload.Name), amount,
		description, datePointer(payload.EndDate), payload.Archived, status)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if err := tx.Commit(request.Context()); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	template, err := server.getRecurringTemplate(request.Context(), authenticated.userID, templateID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, apiRecurringTemplate(template))
}

func GenerateRecurring(ctx context.Context, pool *pgxpool.Pool, now time.Time, batchSize int) (RecurringGenerationResult, error) {
	if batchSize < 1 {
		batchSize = 100
	}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return RecurringGenerationResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var locked bool
	if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock($1)`, recurringWorkerLock).Scan(&locked); err != nil {
		return RecurringGenerationResult{}, err
	}
	if !locked {
		return RecurringGenerationResult{Locked: false}, nil
	}
	rows, err := tx.Query(ctx, `
		SELECT template.id, template.user_id, template.name, template.operation_type,
		       template.amount::text, template.description, template.account_id, template.category_id,
		       template.source_account_id, template.destination_account_id, template.frequency,
		       template.interval_unit, template.interval_count, template.start_date,
		       template.next_scheduled_date, template.end_date, users.timezone
		FROM recurring_templates template
		JOIN users ON users.id = template.user_id
		WHERE template.status = 'ACTIVE' AND template.archived_at IS NULL
		  AND template.next_scheduled_date <= ($1::timestamptz AT TIME ZONE users.timezone)::date
		ORDER BY template.next_scheduled_date, template.id
		FOR UPDATE OF template SKIP LOCKED
		LIMIT $2`, now, batchSize)
	if err != nil {
		return RecurringGenerationResult{}, err
	}
	templates := make([]recurringTemplateRow, 0, batchSize)
	for rows.Next() {
		var row recurringTemplateRow
		var accountID, categoryID, sourceID, destinationID pgtype.UUID
		var description pgtype.Text
		var endDate pgtype.Date
		if err := rows.Scan(&row.ID, &row.UserID, &row.Name, &row.OperationType, &row.Amount,
			&description, &accountID, &categoryID, &sourceID, &destinationID, &row.Frequency,
			&row.IntervalUnit, &row.IntervalCount, &row.StartDate, &row.NextDate, &endDate, &row.Timezone); err != nil {
			rows.Close()
			return RecurringGenerationResult{}, err
		}
		row.Description = textPointer(description)
		row.AccountID, row.CategoryID = uuidPointer(accountID), uuidPointer(categoryID)
		row.SourceAccountID, row.DestinationAccountID = uuidPointer(sourceID), uuidPointer(destinationID)
		row.EndDate = dateValuePointer(endDate)
		templates = append(templates, row)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return RecurringGenerationResult{}, err
	}

	result := RecurringGenerationResult{Locked: true}
	for _, template := range templates {
		location, err := time.LoadLocation(template.Timezone)
		if err != nil {
			return RecurringGenerationResult{}, err
		}
		localNow := now.In(location)
		localToday := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, time.UTC)
		next := dateOnly(template.NextDate)
		start := dateOnly(template.StartDate)
		for !next.After(localToday) && result.Generated < batchSize {
			if template.EndDate != nil && next.After(dateOnly(*template.EndDate)) {
				break
			}
			occurrenceID := uuid.NewSHA1(uuid.NameSpaceOID, []byte(template.ID.String()+"|"+next.Format("2006-01-02")))
			operation := api.CreateTransactionRequest{
				Type: api.CreateTransactionRequestType(template.OperationType), EventDate: openapi_types.Date{Time: next},
				Amount: template.Amount, IdempotencyKey: occurrenceID, Description: template.Description,
				AccountId: template.AccountID, CategoryId: template.CategoryID,
				SourceAccountId: template.SourceAccountID, DestinationAccountId: template.DestinationAccountID,
			}
			transactionID, _, err := postTypedOperation(ctx, tx, pgtype.UUID{Bytes: template.UserID, Valid: true}, operation, nil)
			if err != nil {
				return RecurringGenerationResult{}, err
			}
			tag, err := tx.Exec(ctx, `
				INSERT INTO recurring_occurrences (id, user_id, template_id, scheduled_date, transaction_id)
				VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (template_id, scheduled_date) DO NOTHING`, occurrenceID, template.UserID, template.ID, next, transactionID)
			if err != nil {
				return RecurringGenerationResult{}, err
			}
			if tag.RowsAffected() > 0 {
				result.Generated++
			}
			next = nextRecurringDate(start, next, template.IntervalUnit, template.IntervalCount)
		}
		completed := template.EndDate != nil && next.After(dateOnly(*template.EndDate))
		_, err = tx.Exec(ctx, `
			UPDATE recurring_templates
			SET next_scheduled_date = $2,
			    status = CASE WHEN $3 THEN 'PAUSED' ELSE status END,
			    pause_reason = CASE WHEN $3 THEN 'COMPLETED' ELSE pause_reason END,
			    updated_at = now()
			WHERE id = $1`, template.ID, next, completed)
		if err != nil {
			return RecurringGenerationResult{}, err
		}
		if result.Generated >= batchSize {
			break
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return RecurringGenerationResult{}, err
	}
	return result, nil
}

func materializeOnboardingRecurring(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, functionalCurrency string) error {
	var setupID uuid.UUID
	var name, amount, currency, timezone string
	var dayOfMonth int
	var accountID uuid.UUID
	err := tx.QueryRow(ctx, `
		SELECT setup.id, setup.name, setup.amount::text, setup.currency::text,
		       setup.day_of_month, users.timezone, account_setup.ledger_account_id
		FROM onboarding_recurring_income_setups setup
		JOIN users ON users.id = setup.user_id
		JOIN onboarding_account_setups account_setup ON account_setup.user_id = setup.user_id
		WHERE setup.user_id = $1 AND setup.materialized_at IS NULL
		FOR UPDATE OF setup`, userID).
		Scan(&setupID, &name, &amount, &currency, &dayOfMonth, &timezone, &accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if currency != functionalCurrency {
		return errFXUnavailable
	}
	var accountCurrency string
	if err := tx.QueryRow(ctx, `
		SELECT currency::text FROM ledger_accounts
		WHERE id = $1 AND user_id = $2 AND role = 'USER' AND account_class = 'ASSET' AND archived_at IS NULL
		FOR UPDATE`, accountID, userID).Scan(&accountCurrency); err != nil {
		return err
	}
	if accountCurrency != currency {
		return errFXUnavailable
	}
	var categoryID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT id FROM categories
		WHERE user_id = $1 AND direction = 'INCOME' AND archived_at IS NULL
		ORDER BY lower(name) = 'salary' DESC, created_at, id LIMIT 1 FOR UPDATE`, userID).Scan(&categoryID)
	if errors.Is(err, pgx.ErrNoRows) {
		category, createErr := createCategoryInTx(ctx, tx, userID, "Salary", "INCOME", functionalCurrency)
		if createErr != nil {
			return createErr
		}
		categoryID = category.Id
	} else if err != nil {
		return err
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return err
	}
	localNow := time.Now().In(location)
	start := time.Date(localNow.Year(), localNow.Month(), dayOfMonth, 0, 0, 0, 0, time.UTC)
	localToday := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, time.UTC)
	if start.Before(localToday) {
		start = start.AddDate(0, 1, 0)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO recurring_templates (
		    id, user_id, name, operation_type, amount, currency, description,
		    account_id, category_id, frequency, interval_unit, interval_count,
		    start_date, next_scheduled_date)
		VALUES ($1, $2, $3, 'INCOME', $4::numeric, $5, $3, $6, $7, 'MONTHLY', 'MONTHS', 1, $8, $8)
		ON CONFLICT (id) DO NOTHING`, setupID, userID, strings.TrimSpace(name), amount, currency, accountID, categoryID, start)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE onboarding_recurring_income_setups SET materialized_at = now(), updated_at = now() WHERE id = $1`, setupID)
	return err
}

func normalizeRecurringSchedule(frequency api.RecurringFrequency, unit *api.RecurringIntervalUnit, count *int, start time.Time, end *time.Time) (recurringSchedule, error) {
	if !frequency.Valid() {
		return recurringSchedule{}, fmt.Errorf("%w: choose a recurring frequency", errLedgerValidation)
	}
	result := recurringSchedule{frequency: string(frequency), start: dateOnly(start), end: end}
	switch frequency {
	case api.WEEKLY:
		result.unit, result.count = "WEEKS", 1
	case api.MONTHLY:
		result.unit, result.count = "MONTHS", 1
	case api.QUARTERLY:
		result.unit, result.count = "MONTHS", 3
	case api.YEARLY:
		result.unit, result.count = "YEARS", 1
	case api.CUSTOM:
		if unit == nil || count == nil || !unit.Valid() || *count < 1 || *count > 365 {
			return recurringSchedule{}, fmt.Errorf("%w: custom schedules require a valid interval", errLedgerValidation)
		}
		result.unit, result.count = string(*unit), *count
	}
	if end != nil {
		value := dateOnly(*end)
		result.end = &value
		if value.Before(result.start) {
			return recurringSchedule{}, fmt.Errorf("%w: end date cannot be before start date", errLedgerValidation)
		}
	}
	return result, nil
}

func nextRecurringDate(anchor, current time.Time, unit string, count int) time.Time {
	anchor, current = dateOnly(anchor), dateOnly(current)
	switch unit {
	case "DAYS":
		return current.AddDate(0, 0, count)
	case "WEEKS":
		return current.AddDate(0, 0, 7*count)
	case "MONTHS", "YEARS":
		stepMonths := count
		if unit == "YEARS" {
			stepMonths *= 12
		}
		monthsElapsed := (current.Year()-anchor.Year())*12 + int(current.Month()-anchor.Month())
		index := monthsElapsed/stepMonths + 1
		candidate := addMonthsClamped(anchor, index*stepMonths)
		for !candidate.After(current) {
			index++
			candidate = addMonthsClamped(anchor, index*stepMonths)
		}
		return candidate
	default:
		return current
	}
}

func addMonthsClamped(anchor time.Time, months int) time.Time {
	first := time.Date(anchor.Year(), anchor.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, months, 0)
	lastDay := time.Date(first.Year(), first.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
	day := anchor.Day()
	if day > lastDay {
		day = lastDay
	}
	return time.Date(first.Year(), first.Month(), day, 0, 0, 0, 0, time.UTC)
}

func validateRecurringDependencies(ctx context.Context, tx pgx.Tx, userID pgtype.UUID, operationType string, accountID, categoryID, sourceID, destinationID *uuid.UUID) (string, error) {
	var functionalCurrency string
	if err := tx.QueryRow(ctx, `SELECT functional_currency::text FROM users WHERE id = $1`, userID).Scan(&functionalCurrency); err != nil {
		return "", err
	}
	loadAccount := func(id *uuid.UUID) (ledgerAccount, error) {
		if id == nil {
			return ledgerAccount{}, fmt.Errorf("%w: required account is missing", errLedgerValidation)
		}
		var account ledgerAccount
		var archived bool
		err := tx.QueryRow(ctx, `
			SELECT id, account_class, currency::text, archived_at IS NOT NULL
			FROM ledger_accounts WHERE id = $1 AND user_id = $2 AND role = 'USER' FOR UPDATE`, *id, userID).
			Scan(&account.ID, &account.Class, &account.Currency, &archived)
		if errors.Is(err, pgx.ErrNoRows) {
			return ledgerAccount{}, errLedgerNotFound
		}
		if err != nil {
			return ledgerAccount{}, err
		}
		if archived || account.Class != "ASSET" {
			return ledgerAccount{}, fmt.Errorf("%w: recurring operations require active asset accounts", errLedgerConflict)
		}
		return account, nil
	}
	switch operationType {
	case "INCOME", "EXPENSE":
		account, err := loadAccount(accountID)
		if err != nil {
			return "", err
		}
		if categoryID == nil {
			return "", fmt.Errorf("%w: required category is missing", errLedgerValidation)
		}
		var archived bool
		var direction string
		err = tx.QueryRow(ctx, `SELECT direction, archived_at IS NOT NULL FROM categories WHERE id = $1 AND user_id = $2 FOR UPDATE`, *categoryID, userID).
			Scan(&direction, &archived)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", errLedgerNotFound
		}
		if err != nil {
			return "", err
		}
		if archived || direction != operationType {
			return "", fmt.Errorf("%w: choose an active matching category", errLedgerConflict)
		}
		if account.Currency != functionalCurrency {
			return "", errFXUnavailable
		}
		return account.Currency, nil
	case "TRANSFER", "ASSET_PURCHASE":
		source, err := loadAccount(sourceID)
		if err != nil {
			return "", err
		}
		destination, err := loadAccount(destinationID)
		if err != nil {
			return "", err
		}
		if source.ID == destination.ID {
			return "", fmt.Errorf("%w: source and destination must differ", errLedgerValidation)
		}
		if source.Currency != destination.Currency || source.Currency != functionalCurrency {
			return "", errFXUnavailable
		}
		return source.Currency, nil
	default:
		return "", fmt.Errorf("%w: unsupported recurring operation", errLedgerValidation)
	}
}

const recurringTemplateSelect = `
	SELECT template.id, template.user_id, template.name, template.operation_type,
	       template.amount::text, template.currency::text, template.description,
	       template.account_id, account.name, template.category_id, category.name,
	       template.source_account_id, source.name, template.destination_account_id, destination.name,
	       template.frequency, template.interval_unit, template.interval_count,
	       template.start_date, template.next_scheduled_date, template.end_date,
	       occurrence.last_generated_date, template.status, template.pause_reason,
	       template.archived_at IS NOT NULL
	FROM recurring_templates template
	LEFT JOIN ledger_accounts account ON account.id = template.account_id
	LEFT JOIN categories category ON category.id = template.category_id
	LEFT JOIN ledger_accounts source ON source.id = template.source_account_id
	LEFT JOIN ledger_accounts destination ON destination.id = template.destination_account_id
	LEFT JOIN LATERAL (
	    SELECT max(scheduled_date) AS last_generated_date
	    FROM recurring_occurrences WHERE template_id = template.id
	) occurrence ON true`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanRecurringTemplate(scanner rowScanner) (recurringTemplateRow, error) {
	var row recurringTemplateRow
	var description, accountName, categoryName, sourceName, destinationName, pauseReason pgtype.Text
	var accountID, categoryID, sourceID, destinationID pgtype.UUID
	var endDate, lastDate pgtype.Date
	err := scanner.Scan(&row.ID, &row.UserID, &row.Name, &row.OperationType, &row.Amount, &row.Currency,
		&description, &accountID, &accountName, &categoryID, &categoryName, &sourceID, &sourceName,
		&destinationID, &destinationName, &row.Frequency, &row.IntervalUnit, &row.IntervalCount,
		&row.StartDate, &row.NextDate, &endDate, &lastDate, &row.Status, &pauseReason, &row.Archived)
	if err != nil {
		return recurringTemplateRow{}, err
	}
	row.Description = textPointer(description)
	row.AccountID, row.CategoryID = uuidPointer(accountID), uuidPointer(categoryID)
	row.SourceAccountID, row.DestinationAccountID = uuidPointer(sourceID), uuidPointer(destinationID)
	row.AccountName, row.CategoryName = textPointer(accountName), textPointer(categoryName)
	row.SourceName, row.DestinationName = textPointer(sourceName), textPointer(destinationName)
	row.EndDate, row.LastGeneratedDate = dateValuePointer(endDate), dateValuePointer(lastDate)
	row.PauseReason = textPointer(pauseReason)
	return row, nil
}

func (server *Server) getRecurringTemplate(ctx context.Context, userID pgtype.UUID, templateID uuid.UUID) (recurringTemplateRow, error) {
	row, err := scanRecurringTemplate(server.pool.QueryRow(ctx, recurringTemplateSelect+` WHERE template.id = $1 AND template.user_id = $2`, templateID, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return recurringTemplateRow{}, errLedgerNotFound
	}
	return row, err
}

func apiRecurringTemplate(row recurringTemplateRow) api.RecurringTemplate {
	result := api.RecurringTemplate{
		Id: row.ID, Name: row.Name, Type: api.RecurringOperationType(row.OperationType), Amount: row.Amount,
		Currency: api.Currency(row.Currency), Description: row.Description,
		AccountId: row.AccountID, AccountName: row.AccountName, CategoryId: row.CategoryID, CategoryName: row.CategoryName,
		SourceAccountId: row.SourceAccountID, SourceAccountName: row.SourceName,
		DestinationAccountId: row.DestinationAccountID, DestinationAccountName: row.DestinationName,
		Frequency: api.RecurringFrequency(row.Frequency), IntervalUnit: api.RecurringIntervalUnit(row.IntervalUnit),
		IntervalCount: row.IntervalCount, StartDate: openapi_types.Date{Time: row.StartDate},
		NextScheduledDate: openapi_types.Date{Time: row.NextDate}, Status: api.RecurringTemplateStatus(row.Status),
		PauseReason: row.PauseReason, Archived: row.Archived,
	}
	if row.EndDate != nil {
		value := openapi_types.Date{Time: *row.EndDate}
		result.EndDate = &value
	}
	if row.LastGeneratedDate != nil {
		value := openapi_types.Date{Time: *row.LastGeneratedDate}
		result.LastGeneratedDate = &value
	}
	return result
}

func optionalDescription(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*value)
	if len(trimmed) == 0 || len(trimmed) > 500 {
		return nil, fmt.Errorf("%w: description must contain between 1 and 500 characters", errLedgerValidation)
	}
	return &trimmed, nil
}

func dateOnly(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

func datePointer(value *openapi_types.Date) *time.Time {
	if value == nil {
		return nil
	}
	date := dateOnly(value.Time)
	return &date
}

func dateValuePointer(value pgtype.Date) *time.Time {
	if !value.Valid {
		return nil
	}
	date := dateOnly(value.Time)
	return &date
}

func uuidPointer(value pgtype.UUID) *uuid.UUID {
	if !value.Valid {
		return nil
	}
	id := uuid.UUID(value.Bytes)
	return &id
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func stringPointerEnum(value *api.RecurringTemplateStatus) *string {
	if value == nil {
		return nil
	}
	result := string(*value)
	return &result
}
