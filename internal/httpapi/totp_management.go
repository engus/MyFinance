package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/engus/myfinance/internal/api"
	passwordauth "github.com/engus/myfinance/internal/auth"
	"github.com/engus/myfinance/internal/database"
	"github.com/jackc/pgx/v5"
)

func (server *Server) SetupTOTP(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	queries := database.New(server.pool)
	existing, err := queries.GetTOTPForUser(request.Context(), authenticated.userID)
	if err == nil && existing.EnabledAt.Valid {
		writeError(writer, http.StatusConflict, "totp_already_enabled", "Two-factor authentication is already enabled.")
		return
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	secret, err := passwordauth.GenerateTOTPSecret()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	encrypted, err := passwordauth.EncryptSecret(server.totpEncryptionKey, secret)
	if err != nil {
		Logger(request.Context()).Error("totp_secret_encrypt_failed", "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if err := queries.UpsertPendingTOTP(request.Context(), database.UpsertPendingTOTPParams{
		UserID:           authenticated.userID,
		SecretCiphertext: encrypted,
	}); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	writeAuthAudit(request.Context(), queries, request, authenticated.userID, "totp_setup_started", true, map[string]string{})
	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, http.StatusCreated, api.TOTPSetupResponse{
		Secret:          secret,
		ProvisioningUri: passwordauth.TOTPProvisioningURI(secret, authenticated.row.Email),
	})
}

func (server *Server) ConfirmTOTP(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.TOTPConfirmRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil || len(payload.Code) != 6 {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter a six-digit authenticator code.")
		return
	}

	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	queries := database.New(tx)
	credential, err := queries.GetTOTPForUser(request.Context(), authenticated.userID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(writer, http.StatusConflict, "totp_setup_missing", "Start two-factor setup first.")
		return
	}
	if err != nil || credential.EnabledAt.Valid {
		writeError(writer, http.StatusConflict, "totp_setup_unavailable", "Two-factor setup cannot be confirmed.")
		return
	}
	secret, err := passwordauth.DecryptSecret(server.totpEncryptionKey, credential.SecretCiphertext)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	matchedStep, valid := passwordauth.ValidateTOTP(secret, payload.Code, time.Now(), -1)
	if !valid {
		writeAuthAudit(request.Context(), queries, request, authenticated.userID, "totp_enabled", false, map[string]string{"reason": "invalid_code"})
		if err := tx.Commit(request.Context()); err != nil {
			writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
			return
		}
		writeError(writer, http.StatusBadRequest, "invalid_totp_code", "Authenticator code is incorrect.")
		return
	}
	recoveryCodes, err := passwordauth.GenerateRecoveryCodes()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if err := queries.DeleteRecoveryCodes(request.Context(), authenticated.userID); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	for _, code := range recoveryCodes {
		if err := queries.CreateRecoveryCode(request.Context(), database.CreateRecoveryCodeParams{
			UserID:   authenticated.userID,
			CodeHash: passwordauth.RecoveryCodeHash(code),
		}); err != nil {
			writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
			return
		}
	}
	if err := queries.EnableTOTP(request.Context(), authenticated.userID); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if err := queries.UpdateTOTPLastUsedStep(request.Context(), database.UpdateTOTPLastUsedStepParams{
		LastUsedStep: matchedStep,
		UserID:       authenticated.userID,
	}); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	writeAuthAudit(request.Context(), queries, request, authenticated.userID, "totp_enabled", true, map[string]string{})
	if err := tx.Commit(request.Context()); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, http.StatusOK, api.TOTPConfirmResponse{RecoveryCodes: recoveryCodes})
}

func (server *Server) DisableTOTP(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	var payload api.TOTPDisableRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil || len(payload.Code) != 6 {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter your password and authenticator code.")
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
	passwordValid, err := passwordauth.VerifyPassword(security.PasswordHash, payload.Password)
	if err != nil || !passwordValid {
		writeAuthAudit(request.Context(), queries, request, authenticated.userID, "totp_disabled", false, map[string]string{"reason": "invalid_password"})
		if err := tx.Commit(request.Context()); err != nil {
			writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
			return
		}
		writeError(writer, http.StatusUnauthorized, "invalid_password", "Password is incorrect.")
		return
	}
	credential, err := queries.GetTOTPForUser(request.Context(), authenticated.userID)
	if errors.Is(err, pgx.ErrNoRows) || !credential.EnabledAt.Valid {
		writeError(writer, http.StatusBadRequest, "totp_not_enabled", "Two-factor authentication is not enabled.")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	secret, err := passwordauth.DecryptSecret(server.totpEncryptionKey, credential.SecretCiphertext)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if _, valid := passwordauth.ValidateTOTP(secret, payload.Code, time.Now(), credential.LastUsedStep); !valid {
		writeAuthAudit(request.Context(), queries, request, authenticated.userID, "totp_disabled", false, map[string]string{"reason": "invalid_code"})
		if err := tx.Commit(request.Context()); err != nil {
			writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
			return
		}
		writeError(writer, http.StatusUnauthorized, "invalid_totp_code", "Authenticator code is incorrect.")
		return
	}
	if err := queries.DisableTOTP(request.Context(), authenticated.userID); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if err := queries.DeleteRecoveryCodes(request.Context(), authenticated.userID); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	writeAuthAudit(request.Context(), queries, request, authenticated.userID, "totp_disabled", true, map[string]string{})
	if err := tx.Commit(request.Context()); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
