package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/engus/myfinance/internal/api"
	passwordauth "github.com/engus/myfinance/internal/auth"
	"github.com/engus/myfinance/internal/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

const (
	sessionCookieName = "myfinance_session"
	maxLoginBodyBytes = 16 * 1024
	maxPasswordBytes  = 128
	maxUserAgentBytes = 512

	// A valid hash makes unknown-email and wrong-password attempts perform the same Argon2id work.
	dummyPasswordHash = "$argon2id$v=19$m=65536,t=3,p=2$umHlv8Zv975/UtZqGMayLQ$MYzWQ3SwvrJ2dd1i4zWW3A2Wzggb3BZ36Yh0mXoFOqU"
)

func (server *Server) Login(writer http.ResponseWriter, request *http.Request) {
	client := loginClientKey(request)
	now := time.Now()
	if !server.loginLimiter.allowed(client, now) {
		writer.Header().Set("Retry-After", "900")
		writeError(writer, http.StatusTooManyRequests, "login_rate_limited", "Too many login attempts. Try again later.")
		return
	}

	var payload api.LoginRequest
	if err := readJSON(writer, request, maxLoginBodyBytes, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "Enter a valid email and password.")
		return
	}

	email, emailValid := normalizeEmail(string(payload.Email))
	password := payload.Password
	fields := make(map[string]string)
	if !emailValid {
		fields["email"] = "Enter a valid email address."
	}
	if len(password) < 8 || len(password) > maxPasswordBytes {
		fields["password"] = "Password must contain between 8 and 128 characters."
	}
	if len(fields) > 0 {
		writeFieldError(writer, http.StatusBadRequest, "validation_failed", "Check the highlighted fields.", fields)
		return
	}
	if server.pool == nil {
		writeError(writer, http.StatusServiceUnavailable, "database_unavailable", "Database is unavailable.")
		return
	}

	queries := database.New(server.pool)
	row, err := queries.GetUserForLogin(request.Context(), email)
	if errors.Is(err, pgx.ErrNoRows) {
		_, _ = passwordauth.VerifyPassword(dummyPasswordHash, password)
		server.loginLimiter.failed(client, now)
		writeError(writer, http.StatusUnauthorized, "invalid_credentials", "Email or password is incorrect.")
		return
	}
	if err != nil {
		Logger(request.Context()).Error("login_user_lookup_failed", "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	valid, err := passwordauth.VerifyPassword(row.PasswordHash, password)
	if err != nil {
		Logger(request.Context()).Error("login_password_hash_invalid", "user_id", row.ID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	if !valid {
		server.loginLimiter.failed(client, now)
		writeError(writer, http.StatusUnauthorized, "invalid_credentials", "Email or password is incorrect.")
		return
	}

	token, tokenHash, err := passwordauth.NewSessionToken()
	if err != nil {
		Logger(request.Context()).Error("session_token_generation_failed", "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	userID, err := uuid.Parse(row.ID)
	if err != nil {
		Logger(request.Context()).Error("login_user_id_invalid", "user_id", row.ID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	expiresAt := now.Add(server.sessionTTL)
	userAgent := request.UserAgent()
	if len(userAgent) > maxUserAgentBytes {
		userAgent = userAgent[:maxUserAgentBytes]
	}
	if err := queries.CreateSession(request.Context(), database.CreateSessionParams{
		UserID:    pgtype.UUID{Bytes: userID, Valid: true},
		TokenHash: tokenHash,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
		UserAgent: pgtype.Text{String: userAgent, Valid: userAgent != ""},
	}); err != nil {
		Logger(request.Context()).Error("session_create_failed", "user_id", row.ID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	server.loginLimiter.succeeded(client)
	server.setSessionCookie(writer, token, expiresAt)
	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, http.StatusOK, api.AuthResponse{User: apiUser(
		row.ID,
		row.Email,
		row.DisplayName,
		row.Timezone,
		row.FunctionalCurrency,
		row.DisplayCurrency,
		row.OnboardingCompleted,
	)})
}

func (server *Server) Logout(writer http.ResponseWriter, request *http.Request) {
	cookie, err := request.Cookie(sessionCookieName)
	if err == nil && cookie.Value != "" && server.pool != nil {
		if err := database.New(server.pool).RevokeSession(request.Context(), passwordauth.SessionTokenHash(cookie.Value)); err != nil {
			Logger(request.Context()).Error("session_revoke_failed", "error", err)
			server.clearSessionCookie(writer)
			writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
			return
		}
	}

	server.clearSessionCookie(writer)
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) GetCurrentUser(writer http.ResponseWriter, request *http.Request) {
	if server.pool == nil {
		writeError(writer, http.StatusServiceUnavailable, "database_unavailable", "Database is unavailable.")
		return
	}
	cookie, err := request.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		writeError(writer, http.StatusUnauthorized, "authentication_required", "Sign in to continue.")
		return
	}

	row, err := database.New(server.pool).GetUserBySession(request.Context(), passwordauth.SessionTokenHash(cookie.Value))
	if errors.Is(err, pgx.ErrNoRows) {
		server.clearSessionCookie(writer)
		writeError(writer, http.StatusUnauthorized, "authentication_required", "Your session expired. Sign in again.")
		return
	}
	if err != nil {
		Logger(request.Context()).Error("session_lookup_failed", "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, http.StatusOK, api.AuthResponse{User: apiUser(
		row.ID,
		row.Email,
		row.DisplayName,
		row.Timezone,
		row.FunctionalCurrency,
		row.DisplayCurrency,
		row.OnboardingCompleted,
	)})
}

func apiUser(
	id string,
	email string,
	displayName string,
	timezone string,
	functionalCurrency string,
	displayCurrency string,
	onboardingCompleted bool,
) api.User {
	return api.User{
		Id:                  uuid.MustParse(id),
		Email:               openapi_types.Email(email),
		DisplayName:         displayName,
		Timezone:            timezone,
		FunctionalCurrency:  functionalCurrency,
		DisplayCurrency:     displayCurrency,
		OnboardingCompleted: onboardingCompleted,
	}
}

func normalizeEmail(value string) (string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if len(normalized) < 3 || len(normalized) > 320 {
		return normalized, false
	}
	address, err := mail.ParseAddress(normalized)
	return normalized, err == nil && address.Address == normalized
}

func loginClientKey(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	if request.RemoteAddr != "" {
		return request.RemoteAddr
	}
	return "unknown"
}

func (server *Server) setSessionCookie(writer http.ResponseWriter, token string, expiresAt time.Time) {
	http.SetCookie(writer, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   int(server.sessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   server.sessionCookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (server *Server) clearSessionCookie(writer http.ResponseWriter) {
	http.SetCookie(writer, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   server.sessionCookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func readJSON(writer http.ResponseWriter, request *http.Request, maximum int64, destination any) error {
	request.Body = http.MaxBytesReader(writer, request.Body, maximum)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}
