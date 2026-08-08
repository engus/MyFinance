package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/engus/myfinance/internal/api"
	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	pool    *pgxpool.Pool
	version string
}

func NewServer(pool *pgxpool.Pool, version string) *Server {
	return &Server{pool: pool, version: version}
}

func NewHandler(server *Server, logger *slog.Logger) http.Handler {
	router := chi.NewRouter()
	router.Use(chimiddleware.RequestID)
	router.Use(func(next http.Handler) http.Handler { return requestContext(logger, next) })
	router.Use(func(next http.Handler) http.Handler { return accessLog(logger, next) })
	router.Use(func(next http.Handler) http.Handler { return recoverer(logger, next) })

	api.HandlerFromMux(server, router)
	router.Get("/api/openapi.json", serveOpenAPI)

	return router
}

func (server *Server) GetLiveness(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "api",
		"version": server.version,
	})
}

func (server *Server) GetReadiness(writer http.ResponseWriter, request *http.Request) {
	if server.pool == nil {
		writeError(writer, http.StatusServiceUnavailable, "database_unavailable", "Database is unavailable.")
		return
	}

	ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
	defer cancel()

	if err := server.pool.Ping(ctx); err != nil {
		Logger(request.Context()).Warn("readiness_failed", "dependency", "database", "error", err)
		writeError(writer, http.StatusServiceUnavailable, "database_unavailable", "Database is unavailable.")
		return
	}

	writeJSON(writer, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "api",
		"version": server.version,
	})
}

func serveOpenAPI(writer http.ResponseWriter, _ *http.Request) {
	spec, err := api.GetSwagger()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "openapi_unavailable", "OpenAPI document is unavailable.")
		return
	}

	writeJSON(writer, http.StatusOK, spec)
}

func writeError(writer http.ResponseWriter, status int, code string, message string) {
	writeJSON(writer, status, map[string]any{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}

func writeJSON(writer http.ResponseWriter, status int, body any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	if err := json.NewEncoder(writer).Encode(body); err != nil {
		slog.Default().Error("write_json_response", "error", err)
	}
}
