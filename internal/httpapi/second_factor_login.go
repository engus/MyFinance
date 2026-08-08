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
)

func (server *Server) VerifyLoginTOTP(writer http.ResponseWriter, request *http.Request) {
	client := loginClientKey(request)
	if !server.loginLimiter.allowed(client, time.Now()) {
		writer.Header().Set("Retry-After", "900")
		writeError(writer, http.StatusTooManyRequests, "login_rate_limited", "Too many login attempts. Try again later.")
		return
	}
	if server.pool == nil {
		writeError(writer, http.StatusServiceUnavailable, "database_unavailable", "Database is unavailable.")
		return
	}

	var payload api.TOTPLoginRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil ||
		len(payload.ChallengeToken) < 40 || len(payload.Code) != 6 {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter a valid authenticator code.")
		return
	}

	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	queries := database.New(tx)
	challenge, err := queries.GetLoginChallengeForUpdate(
		request.Context(),
		passwordauth.SessionTokenHash(payload.ChallengeToken),
	)
	if errors.Is(err, pgx.ErrNoRows) {
		server.loginLimiter.failed(client, time.Now())
		writeError(writer, http.StatusUnauthorized, "invalid_login_challenge", "The login challenge expired or is invalid.")
		return
	}
	if err != nil {
		Logger(request.Context()).Error("totp_challenge_lookup_failed", "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	challengeID, err := parsePGUUID(challenge.ChallengeID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	userID, err := parsePGUUID(challenge.UserID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	secret, err := passwordauth.DecryptSecret(server.totpEncryptionKey, challenge.SecretCiphertext)
	if err != nil {
		Logger(request.Context()).Error("totp_secret_decrypt_failed", "user_id", challenge.UserID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	matchedStep, valid := passwordauth.ValidateTOTP(secret, payload.Code, time.Now(), challenge.LastUsedStep)
	if !valid {
		_ = queries.IncrementLoginChallengeAttempts(request.Context(), challengeID)
		writeAuthAudit(request.Context(), queries, request, userID, "login_totp", false, map[string]string{"reason": "invalid_code"})
		if err := tx.Commit(request.Context()); err != nil {
			writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
			return
		}
		server.loginLimiter.failed(client, time.Now())
		writeError(writer, http.StatusUnauthorized, "invalid_totp_code", "Authenticator code is incorrect.")
		return
	}

	if err := queries.UpdateTOTPLastUsedStep(request.Context(), database.UpdateTOTPLastUsedStepParams{
		LastUsedStep: matchedStep,
		UserID:       userID,
	}); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if err := queries.ConsumeLoginChallenge(request.Context(), challengeID); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	token, expiresAt, err := server.createSession(request.Context(), queries, userID, request)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	writeAuthAudit(request.Context(), queries, request, userID, "login", true, map[string]string{"method": "totp"})
	if err := tx.Commit(request.Context()); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	server.loginLimiter.succeeded(client)
	server.setSessionCookie(writer, token, expiresAt)
	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, http.StatusOK, api.AuthResponse{User: apiUser(
		challenge.UserID,
		challenge.Email,
		challenge.DisplayName,
		challenge.Timezone,
		challenge.FunctionalCurrency,
		challenge.DisplayCurrency,
		challenge.ReconciliationMode,
		challenge.OnboardingCompleted,
		true,
	)})
}

func (server *Server) VerifyLoginRecoveryCode(writer http.ResponseWriter, request *http.Request) {
	client := loginClientKey(request)
	if !server.loginLimiter.allowed(client, time.Now()) {
		writer.Header().Set("Retry-After", "900")
		writeError(writer, http.StatusTooManyRequests, "login_rate_limited", "Too many login attempts. Try again later.")
		return
	}
	if server.pool == nil {
		writeError(writer, http.StatusServiceUnavailable, "database_unavailable", "Database is unavailable.")
		return
	}

	var payload api.RecoveryLoginRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil ||
		len(payload.ChallengeToken) < 40 || len(strings.TrimSpace(payload.RecoveryCode)) < 16 {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter a valid recovery code.")
		return
	}

	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	queries := database.New(tx)
	challenge, err := queries.GetLoginChallengeForUpdate(
		request.Context(),
		passwordauth.SessionTokenHash(payload.ChallengeToken),
	)
	if errors.Is(err, pgx.ErrNoRows) {
		server.loginLimiter.failed(client, time.Now())
		writeError(writer, http.StatusUnauthorized, "invalid_login_challenge", "The login challenge expired or is invalid.")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	challengeID, err := parsePGUUID(challenge.ChallengeID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	userID, err := parsePGUUID(challenge.UserID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	recoveryCodeID, err := queries.GetRecoveryCodeForUpdate(request.Context(), database.GetRecoveryCodeForUpdateParams{
		UserID:   userID,
		CodeHash: passwordauth.RecoveryCodeHash(payload.RecoveryCode),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		_ = queries.IncrementLoginChallengeAttempts(request.Context(), challengeID)
		writeAuthAudit(request.Context(), queries, request, userID, "login_recovery", false, map[string]string{"reason": "invalid_code"})
		if err := tx.Commit(request.Context()); err != nil {
			writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
			return
		}
		server.loginLimiter.failed(client, time.Now())
		writeError(writer, http.StatusUnauthorized, "invalid_recovery_code", "Recovery code is incorrect or already used.")
		return
	}
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	parsedRecoveryID, err := parsePGUUID(recoveryCodeID)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if err := queries.UseRecoveryCode(request.Context(), parsedRecoveryID); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if err := queries.ConsumeLoginChallenge(request.Context(), challengeID); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	token, expiresAt, err := server.createSession(request.Context(), queries, userID, request)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	writeAuthAudit(request.Context(), queries, request, userID, "login", true, map[string]string{"method": "recovery_code"})
	if err := tx.Commit(request.Context()); err != nil {
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	server.loginLimiter.succeeded(client)
	server.setSessionCookie(writer, token, expiresAt)
	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, http.StatusOK, api.AuthResponse{User: apiUser(
		challenge.UserID,
		challenge.Email,
		challenge.DisplayName,
		challenge.Timezone,
		challenge.FunctionalCurrency,
		challenge.DisplayCurrency,
		challenge.ReconciliationMode,
		challenge.OnboardingCompleted,
		true,
	)})
}
