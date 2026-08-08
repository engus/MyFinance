package httpapi

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
)

type responseRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (recorder *responseRecorder) WriteHeader(status int) {
	recorder.status = status
	recorder.ResponseWriter.WriteHeader(status)
}

func (recorder *responseRecorder) Write(body []byte) (int, error) {
	if recorder.status == 0 {
		recorder.WriteHeader(http.StatusOK)
	}

	written, err := recorder.ResponseWriter.Write(body)
	recorder.bytes += written
	return written, err
}

func requestContext(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestID := chimiddleware.GetReqID(request.Context())
		writer.Header().Set("X-Request-ID", requestID)
		next.ServeHTTP(writer, request.WithContext(withLogger(request.Context(), logger.With("request_id", requestID))))
	})
}

func accessLog(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		started := time.Now()
		recorder := &responseRecorder{ResponseWriter: writer}

		next.ServeHTTP(recorder, request)

		logger.InfoContext(
			request.Context(),
			"http_request",
			"request_id", chimiddleware.GetReqID(request.Context()),
			"method", request.Method,
			"path", request.URL.Path,
			"status", recorder.status,
			"bytes", recorder.bytes,
			"duration_ms", time.Since(started).Milliseconds(),
		)
	})
}

func recoverer(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.ErrorContext(
					request.Context(),
					"panic_recovered",
					"request_id", chimiddleware.GetReqID(request.Context()),
					"panic", recovered,
					"stack", string(debug.Stack()),
				)
				writeError(writer, http.StatusInternalServerError, "internal_error", "An internal error occurred.")
			}
		}()

		next.ServeHTTP(writer, request)
	})
}
