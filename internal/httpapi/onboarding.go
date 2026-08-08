package httpapi

import (
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/engus/myfinance/internal/api"
	"github.com/engus/myfinance/internal/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	decimalAmountPattern  = regexp.MustCompile(`^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,8})?$`)
	positiveAmountPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,15})(\.[0-9]{1,8})?$`)
)

func (server *Server) CompleteOnboarding(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.CompleteOnboardingRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter valid onboarding details.")
		return
	}
	fields := validateOnboarding(payload)
	if len(fields) > 0 {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", fields)
		return
	}
	openingBalance, err := numericFromString(payload.Account.OpeningBalance)
	if err != nil {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", map[string]string{"account.openingBalance": "Enter a valid amount with up to 8 decimal places."})
		return
	}

	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	queries := database.New(tx)
	alreadyCompleted, err := queries.LockUserForOnboarding(request.Context(), authenticated.userID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if alreadyCompleted {
		writeError(writer, http.StatusConflict, "onboarding_already_completed", "Onboarding has already been completed.")
		return
	}

	accountSetupID, err := queries.CreateOnboardingAccountSetup(request.Context(), database.CreateOnboardingAccountSetupParams{
		UserID:             authenticated.userID,
		Name:               strings.TrimSpace(payload.Account.Name),
		AccountClass:       string(payload.Account.AccountClass),
		Subtype:            string(payload.Account.Subtype),
		Currency:           string(payload.Account.Currency),
		OpeningBalance:     openingBalance,
		OpeningBalanceDate: pgtype.Date{Time: payload.Account.OpeningBalanceDate.Time, Valid: true},
	})
	if err != nil {
		Logger(request.Context()).Error("onboarding_account_setup_failed", "user_id", authenticated.row.ID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	var recurringSetupID *uuid.UUID
	if payload.RecurringIncome != nil {
		amount, err := numericFromString(payload.RecurringIncome.Amount)
		if err != nil {
			writeError(writer, http.StatusBadRequest, "invalid_recurring_income", "Enter a valid recurring income amount.")
			return
		}
		createdID, err := queries.CreateOnboardingRecurringIncomeSetup(request.Context(), database.CreateOnboardingRecurringIncomeSetupParams{
			UserID:     authenticated.userID,
			Name:       strings.TrimSpace(payload.RecurringIncome.Name),
			Amount:     amount,
			Currency:   string(payload.RecurringIncome.Currency),
			DayOfMonth: int16(payload.RecurringIncome.DayOfMonth),
		})
		if err != nil {
			writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
			return
		}
		parsed := uuid.MustParse(createdID)
		recurringSetupID = &parsed
	}

	updated, err := queries.CompleteUserOnboarding(request.Context(), database.CompleteUserOnboardingParams{
		Timezone:           payload.Timezone,
		FunctionalCurrency: string(payload.FunctionalCurrency),
		DisplayCurrency:    string(payload.DisplayCurrency),
		ReconciliationMode: string(payload.ReconciliationMode),
		UserID:             authenticated.userID,
	})
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	functionalCurrency, openingEquityID, err := ensureLedgerInfrastructure(request.Context(), tx, authenticated.userID)
	if err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	if err := materializeOnboardingAccount(request.Context(), tx, authenticated.userID, functionalCurrency, openingEquityID); err != nil {
		server.writeLedgerError(writer, request, err)
		return
	}
	writeAuthAudit(request.Context(), queries, request, authenticated.userID, "onboarding_completed", true, map[string]string{
		"recurring_income": boolString(payload.RecurringIncome != nil),
	})
	if err := tx.Commit(request.Context()); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	writeJSON(writer, http.StatusOK, api.CompleteOnboardingResponse{
		AccountSetupId:         uuid.MustParse(accountSetupID),
		RecurringIncomeSetupId: recurringSetupID,
		User: apiUser(
			updated.ID,
			updated.Email,
			updated.DisplayName,
			updated.Timezone,
			updated.FunctionalCurrency,
			updated.DisplayCurrency,
			updated.ReconciliationMode,
			updated.OnboardingCompleted,
			authenticated.row.TotpEnabled,
		),
	})
}

func validateOnboarding(payload api.CompleteOnboardingRequest) map[string]string {
	fields := make(map[string]string)
	if _, err := time.LoadLocation(payload.Timezone); err != nil {
		fields["timezone"] = "Select a valid IANA timezone."
	}
	if !payload.FunctionalCurrency.Valid() {
		fields["functionalCurrency"] = "Select a supported currency."
	}
	if !payload.DisplayCurrency.Valid() {
		fields["displayCurrency"] = "Select a supported currency."
	}
	if !payload.ReconciliationMode.Valid() {
		fields["reconciliationMode"] = "Select a reconciliation mode."
	}
	if len(strings.TrimSpace(payload.Account.Name)) < 1 || len(payload.Account.Name) > 100 {
		fields["account.name"] = "Account name must contain between 1 and 100 characters."
	}
	if !payload.Account.AccountClass.Valid() {
		fields["account.accountClass"] = "Select an account class."
	}
	if !payload.Account.Subtype.Valid() {
		fields["account.subtype"] = "Select an account type."
	}
	if !payload.Account.Currency.Valid() {
		fields["account.currency"] = "Select a supported currency."
	}
	if !decimalAmountPattern.MatchString(payload.Account.OpeningBalance) {
		fields["account.openingBalance"] = "Enter a valid amount with up to 8 decimal places."
	}
	if payload.Account.OpeningBalanceDate.Time.After(time.Now().AddDate(0, 0, 1)) {
		fields["account.openingBalanceDate"] = "Opening balance date cannot be in the future."
	}
	liabilitySubtype := payload.Account.Subtype == api.OnboardingAccountSubtypeLoan || payload.Account.Subtype == api.OnboardingAccountSubtypeMortgage
	if payload.Account.AccountClass == api.OnboardingAccountAccountClassASSET && liabilitySubtype {
		fields["account.subtype"] = "Loan and mortgage accounts must be liabilities."
	}
	if payload.Account.AccountClass == api.OnboardingAccountAccountClassLIABILITY && !liabilitySubtype && payload.Account.Subtype != api.OnboardingAccountSubtypeOther {
		fields["account.subtype"] = "Liabilities must use loan, mortgage, or other."
	}
	if payload.RecurringIncome != nil {
		if len(strings.TrimSpace(payload.RecurringIncome.Name)) < 1 || len(payload.RecurringIncome.Name) > 100 {
			fields["recurringIncome.name"] = "Income name must contain between 1 and 100 characters."
		}
		if !isPositiveDecimal(payload.RecurringIncome.Amount) {
			fields["recurringIncome.amount"] = "Enter an amount greater than zero with up to 8 decimal places."
		}
		if !payload.RecurringIncome.Currency.Valid() {
			fields["recurringIncome.currency"] = "Select a supported currency."
		}
		if payload.RecurringIncome.DayOfMonth < 1 || payload.RecurringIncome.DayOfMonth > 28 {
			fields["recurringIncome.dayOfMonth"] = "Choose a day from 1 through 28."
		}
	}
	return fields
}

func isPositiveDecimal(value string) bool {
	if !positiveAmountPattern.MatchString(value) {
		return false
	}
	amount, ok := new(big.Rat).SetString(value)
	return ok && amount.Sign() > 0
}

func numericFromString(value string) (pgtype.Numeric, error) {
	var numeric pgtype.Numeric
	err := numeric.Scan(value)
	return numeric, err
}
