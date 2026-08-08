package httpapi

import (
	"context"
	"errors"
	"net/http"
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

type authenticatedSession struct {
	row       database.GetUserBySessionRow
	userID    pgtype.UUID
	token     string
	tokenHash []byte
}

func (server *Server) requireAuthenticatedSession(
	writer http.ResponseWriter,
	request *http.Request,
) (authenticatedSession, bool) {
	if server.pool == nil {
		writeError(writer, http.StatusServiceUnavailable, "database_unavailable", "Database is unavailable.")
		return authenticatedSession{}, false
	}
	cookie, err := request.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		writeError(writer, http.StatusUnauthorized, "authentication_required", "Sign in to continue.")
		return authenticatedSession{}, false
	}

	tokenHash := passwordauth.SessionTokenHash(cookie.Value)
	queries := database.New(server.pool)
	row, err := queries.GetUserBySession(request.Context(), tokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
		server.clearSessionCookie(writer)
		writeError(writer, http.StatusUnauthorized, "authentication_required", "Your session expired. Sign in again.")
		return authenticatedSession{}, false
	}
	if err != nil {
		Logger(request.Context()).Error("session_lookup_failed", "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return authenticatedSession{}, false
	}

	userID, err := parsePGUUID(row.ID)
	if err != nil {
		Logger(request.Context()).Error("session_user_id_invalid", "user_id", row.ID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return authenticatedSession{}, false
	}
	if err := queries.TouchSession(request.Context(), tokenHash); err != nil {
		Logger(request.Context()).Warn("session_touch_failed", "user_id", row.ID, "error", err)
	}

	return authenticatedSession{
		row:       row,
		userID:    userID,
		token:     cookie.Value,
		tokenHash: tokenHash,
	}, true
}

func (server *Server) createSession(
	ctx context.Context,
	queries *database.Queries,
	userID pgtype.UUID,
	request *http.Request,
) (string, time.Time, error) {
	token, tokenHash, err := passwordauth.NewSessionToken()
	if err != nil {
		return "", time.Time{}, err
	}
	expiresAt := time.Now().Add(server.sessionTTL)
	userAgent := strings.ToValidUTF8(request.UserAgent(), "")
	if len(userAgent) > maxUserAgentBytes {
		userAgent = strings.ToValidUTF8(userAgent[:maxUserAgentBytes], "")
	}
	_, err = queries.CreateSession(ctx, database.CreateSessionParams{
		UserID:    userID,
		TokenHash: tokenHash,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
		UserAgent: pgtype.Text{String: userAgent, Valid: userAgent != ""},
	})
	if err != nil {
		return "", time.Time{}, err
	}
	return token, expiresAt, nil
}

func parsePGUUID(value string) (pgtype.UUID, error) {
	parsed, err := uuid.Parse(value)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: parsed, Valid: true}, nil
}

func apiUser(
	id string,
	email string,
	displayName string,
	timezone string,
	functionalCurrency string,
	displayCurrency string,
	reconciliationMode string,
	onboardingCompleted bool,
	totpEnabled bool,
) api.User {
	return api.User{
		Id:                  uuid.MustParse(id),
		Email:               openapi_types.Email(email),
		DisplayName:         displayName,
		Timezone:            timezone,
		FunctionalCurrency:  api.Currency(functionalCurrency),
		DisplayCurrency:     api.Currency(displayCurrency),
		ReconciliationMode:  api.ReconciliationMode(reconciliationMode),
		OnboardingCompleted: onboardingCompleted,
		TotpEnabled:         totpEnabled,
	}
}

func apiUserFromSession(row database.GetUserBySessionRow) api.User {
	return apiUser(
		row.ID,
		row.Email,
		row.DisplayName,
		row.Timezone,
		row.FunctionalCurrency,
		row.DisplayCurrency,
		row.ReconciliationMode,
		row.OnboardingCompleted,
		row.TotpEnabled,
	)
}
