package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/engus/myfinance/internal/database"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgtype"
)

func writeAuthAudit(
	ctx context.Context,
	queries *database.Queries,
	request *http.Request,
	userID pgtype.UUID,
	eventType string,
	success bool,
	metadata map[string]string,
) {
	encodedMetadata, err := json.Marshal(metadata)
	if err != nil {
		Logger(ctx).Error("auth_audit_metadata_failed", "event_type", eventType, "error", err)
		return
	}
	requestID := chimiddleware.GetReqID(request.Context())
	if err := queries.CreateAuthAuditEvent(ctx, database.CreateAuthAuditEventParams{
		UserID:    userID,
		EventType: eventType,
		Success:   success,
		RequestID: pgtype.Text{String: requestID, Valid: requestID != ""},
		Metadata:  encodedMetadata,
	}); err != nil {
		Logger(ctx).Error("auth_audit_write_failed", "event_type", eventType, "error", err)
	}
}
