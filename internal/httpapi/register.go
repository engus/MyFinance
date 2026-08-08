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

func (server *Server) Register(writer http.ResponseWriter, request *http.Request) {
	client := loginClientKey(request)
	if !server.registrationLimiter.allowed(client, time.Now()) {
		writer.Header().Set("Retry-After", "3600")
		writeError(writer, http.StatusTooManyRequests, "registration_rate_limited", "Too many registration attempts. Try again later.")
		return
	}

	var payload api.RegisterRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter valid registration details.")
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
	if message := validateNewPassword(payload.Password, email); message != "" {
		fields["password"] = message
	}
	if len(fields) > 0 {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", fields)
		return
	}
	if server.pool == nil {
		writeError(writer, http.StatusServiceUnavailable, "database_unavailable", "Database is unavailable.")
		return
	}

	passwordHash, err := passwordauth.HashPassword(payload.Password)
	if err != nil {
		Logger(request.Context()).Error("registration_password_hash_failed", "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	tx, err := server.pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		Logger(request.Context()).Error("registration_transaction_start_failed", "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	queries := database.New(tx)
	user, err := queries.CreateUser(request.Context(), database.CreateUserParams{
		Email:        email,
		DisplayName:  displayName,
		PasswordHash: passwordHash,
	})
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "23505" {
			server.registrationLimiter.failed(client, time.Now())
			writeError(writer, http.StatusConflict, "email_in_use", "An account with this email already exists.")
			return
		}
		Logger(request.Context()).Error("registration_user_create_failed", "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	userID, err := parsePGUUID(user.ID)
	if err != nil {
		Logger(request.Context()).Error("registration_user_id_invalid", "user_id", user.ID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	token, expiresAt, err := server.createSession(request.Context(), queries, userID, request)
	if err != nil {
		Logger(request.Context()).Error("registration_session_create_failed", "user_id", user.ID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	writeAuthAudit(request.Context(), queries, request, userID, "registration", true, map[string]string{})
	if err := tx.Commit(request.Context()); err != nil {
		Logger(request.Context()).Error("registration_commit_failed", "user_id", user.ID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	server.registrationLimiter.succeeded(client)
	server.setSessionCookie(writer, token, expiresAt)
	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, http.StatusCreated, api.AuthResponse{User: apiUser(
		user.ID,
		user.Email,
		user.DisplayName,
		user.Timezone,
		user.FunctionalCurrency,
		user.DisplayCurrency,
		user.ReconciliationMode,
		user.OnboardingCompleted,
		false,
	)})
}

func validateNewPassword(password string, email string) string {
	if len(password) < 12 || len(password) > maxPasswordBytes {
		return "Password must contain between 12 and 128 characters."
	}
	normalized := strings.ToLower(password)
	if strings.Contains(normalized, strings.ToLower(email)) || strings.TrimSpace(password) == "" {
		return "Choose a password that does not contain your email address."
	}
	return ""
}
