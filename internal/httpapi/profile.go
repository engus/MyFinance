package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/engus/myfinance/internal/api"
	passwordauth "github.com/engus/myfinance/internal/auth"
	"github.com/engus/myfinance/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func (server *Server) UpdateProfile(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.UpdateProfileRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter valid profile details.")
		return
	}
	email, emailValid := normalizeEmail(string(payload.Email))
	displayName := strings.TrimSpace(payload.DisplayName)
	fields := make(map[string]string)
	if !emailValid {
		fields["email"] = "Enter a valid email address."
	}
	if len(displayName) < 1 || len(displayName) > 100 {
		fields["displayName"] = "Display name must contain between 1 and 100 characters."
	}
	if email != authenticated.row.Email && (payload.CurrentPassword == nil || *payload.CurrentPassword == "") {
		fields["currentPassword"] = "Enter your current password to change email."
	}
	if len(fields) > 0 {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", fields)
		return
	}

	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	queries := database.New(tx)
	security, err := queries.GetUserSecurityForUpdate(request.Context(), authenticated.userID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if email != security.Email {
		valid, err := passwordauth.VerifyPassword(security.PasswordHash, *payload.CurrentPassword)
		if err != nil || !valid {
			writeAuthAudit(request.Context(), queries, request, authenticated.userID, "email_change", false, map[string]string{"reason": "invalid_password"})
			if err := tx.Commit(request.Context()); err != nil {
				writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
				return
			}
			writeError(writer, http.StatusUnauthorized, "invalid_password", "Current password is incorrect.")
			return
		}
	}
	updated, err := queries.UpdateUserProfile(request.Context(), database.UpdateUserProfileParams{
		Email:       email,
		DisplayName: displayName,
		UserID:      authenticated.userID,
	})
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "23505" {
			writeError(writer, http.StatusConflict, "email_in_use", "An account with this email already exists.")
			return
		}
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	writeAuthAudit(request.Context(), queries, request, authenticated.userID, "profile_updated", true, map[string]string{
		"email_changed": boolString(email != security.Email),
	})
	if err := tx.Commit(request.Context()); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	writeJSON(writer, http.StatusOK, api.AuthResponse{User: apiUser(
		updated.ID,
		updated.Email,
		updated.DisplayName,
		updated.Timezone,
		updated.FunctionalCurrency,
		updated.DisplayCurrency,
		updated.ReconciliationMode,
		updated.OnboardingCompleted,
		authenticated.row.TotpEnabled,
	)})
}

func (server *Server) ChangePassword(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.ChangePasswordRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter your current and new password.")
		return
	}
	if message := validateNewPassword(payload.NewPassword, authenticated.row.Email); message != "" {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", map[string]string{"newPassword": message})
		return
	}
	newHash, err := passwordauth.HashPassword(payload.NewPassword)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	queries := database.New(tx)
	security, err := queries.GetUserSecurityForUpdate(request.Context(), authenticated.userID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	valid, err := passwordauth.VerifyPassword(security.PasswordHash, payload.CurrentPassword)
	if err != nil || !valid {
		writeAuthAudit(request.Context(), queries, request, authenticated.userID, "password_change", false, map[string]string{"reason": "invalid_password"})
		if err := tx.Commit(request.Context()); err != nil {
			writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
			return
		}
		writeError(writer, http.StatusUnauthorized, "invalid_password", "Current password is incorrect.")
		return
	}
	if err := queries.UpdateUserPassword(request.Context(), database.UpdateUserPasswordParams{
		PasswordHash: newHash,
		UserID:       authenticated.userID,
	}); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if err := queries.RevokeOtherUserSessions(request.Context(), database.RevokeOtherUserSessionsParams{
		UserID:           authenticated.userID,
		CurrentTokenHash: authenticated.tokenHash,
	}); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	writeAuthAudit(request.Context(), queries, request, authenticated.userID, "password_change", true, map[string]string{})
	if err := tx.Commit(request.Context()); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) UpdateUserSettings(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.UpdateUserSettingsRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter valid workspace settings.")
		return
	}
	fields := make(map[string]string)
	if _, err := time.LoadLocation(payload.Timezone); err != nil {
		fields["timezone"] = "Enter a valid IANA timezone."
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
	if len(fields) > 0 {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", fields)
		return
	}

	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	queries := database.New(tx)
	var currentFunctionalCurrency string
	var hasPostings bool
	if err := tx.QueryRow(request.Context(), `
		SELECT functional_currency::text,
		       EXISTS (SELECT 1 FROM ledger_transactions WHERE user_id = users.id AND posted_at IS NOT NULL)
		FROM users WHERE id = $1 FOR UPDATE`, authenticated.userID).Scan(&currentFunctionalCurrency, &hasPostings); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if hasPostings && string(payload.FunctionalCurrency) != currentFunctionalCurrency {
		writeError(writer, http.StatusConflict, "functional_currency_locked", "Functional currency is locked after the first ledger posting.")
		return
	}
	updated, err := queries.UpdateUserSettings(request.Context(), database.UpdateUserSettingsParams{
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
	writeAuthAudit(request.Context(), queries, request, authenticated.userID, "settings_updated", true, map[string]string{})
	if err := tx.Commit(request.Context()); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	writeJSON(writer, http.StatusOK, api.AuthResponse{User: apiUser(
		updated.ID,
		updated.Email,
		updated.DisplayName,
		updated.Timezone,
		updated.FunctionalCurrency,
		updated.DisplayCurrency,
		updated.ReconciliationMode,
		updated.OnboardingCompleted,
		authenticated.row.TotpEnabled,
	)})
}

func (server *Server) DeleteAccount(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.DeleteAccountRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil || payload.Password == "" {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter your password to delete the account.")
		return
	}

	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	queries := database.New(tx)
	security, err := queries.GetUserSecurityForUpdate(request.Context(), authenticated.userID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	valid, err := passwordauth.VerifyPassword(security.PasswordHash, payload.Password)
	if err != nil || !valid {
		writeAuthAudit(request.Context(), queries, request, authenticated.userID, "account_deletion", false, map[string]string{"reason": "invalid_password"})
		if err := tx.Commit(request.Context()); err != nil {
			writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
			return
		}
		writeError(writer, http.StatusUnauthorized, "invalid_password", "Password is incorrect.")
		return
	}
	writeAuthAudit(request.Context(), queries, request, authenticated.userID, "account_deletion", true, map[string]string{})
	if err := queries.DeleteUser(request.Context(), authenticated.userID); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if err := tx.Commit(request.Context()); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	server.clearSessionCookie(writer)
	writer.WriteHeader(http.StatusNoContent)
}
