package httpapi

import (
	"bytes"
	"errors"
	"net/http"

	"github.com/engus/myfinance/internal/api"
	"github.com/engus/myfinance/internal/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func (server *Server) ListSessions(writer http.ResponseWriter, request *http.Request) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	rows, err := database.New(server.pool).ListUserSessions(request.Context(), database.ListUserSessionsParams{
		CurrentTokenHash: authenticated.tokenHash,
		UserID:           authenticated.userID,
	})
	if err != nil {
		Logger(request.Context()).Error("session_list_failed", "user_id", authenticated.row.ID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}

	sessions := make([]api.Session, 0, len(rows))
	for _, row := range rows {
		sessionID, err := uuid.Parse(row.ID)
		if err != nil {
			Logger(request.Context()).Error("session_id_invalid", "session_id", row.ID, "error", err)
			writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
			return
		}
		item := api.Session{
			Id:         openapi_types.UUID(sessionID),
			CreatedAt:  row.CreatedAt.Time,
			LastSeenAt: row.LastSeenAt.Time,
			ExpiresAt:  row.ExpiresAt.Time,
			Current:    row.Current,
		}
		if row.UserAgent.Valid {
			item.UserAgent = &row.UserAgent.String
		}
		sessions = append(sessions, item)
	}
	writer.Header().Set("Cache-Control", "no-store")
	writeJSON(writer, http.StatusOK, api.SessionListResponse{Sessions: sessions})
}

func (server *Server) RevokeSession(
	writer http.ResponseWriter,
	request *http.Request,
	sessionID openapi_types.UUID,
) {
	authenticated, ok := server.requireAuthenticatedSession(writer, request)
	if !ok {
		return
	}
	queries := database.New(server.pool)
	revokedTokenHash, err := queries.RevokeUserSession(request.Context(), database.RevokeUserSessionParams{
		SessionID: pgtype.UUID{Bytes: sessionID, Valid: true},
		UserID:    authenticated.userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(writer, http.StatusNotFound, "session_not_found", "Session was not found.")
		return
	}
	if err != nil {
		Logger(request.Context()).Error("session_revoke_owned_failed", "user_id", authenticated.row.ID, "error", err)
		writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
		return
	}
	writeAuthAudit(request.Context(), queries, request, authenticated.userID, "session_revoked", true, map[string]string{
		"current": boolString(bytes.Equal(revokedTokenHash, authenticated.tokenHash)),
	})
	if bytes.Equal(revokedTokenHash, authenticated.tokenHash) {
		server.clearSessionCookie(writer)
	}
	writer.WriteHeader(http.StatusNoContent)
}

func boolString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
