package httpapi

import (
	"log/slog"
	"net/http"
	"net/url"
	"runtime/debug"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
)

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		writer.Header().Set("Referrer-Policy", "no-referrer")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		writer.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(writer, request)
	})
}

func csrfProtection(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet || request.Method == http.MethodHead || request.Method == http.MethodOptions {
			next.ServeHTTP(writer, request)
			return
		}
		if request.Header.Get("Sec-Fetch-Site") == "cross-site" {
			writeError(writer, http.StatusForbidden, "cross_site_request_blocked", "Cross-site request was blocked.")
			return
		}
		origin := request.Header.Get("Origin")
		if origin != "" {
			parsed, err := url.Parse(origin)
			expectedHost := request.Header.Get("X-Forwarded-Host")
			if expectedHost == "" {
				expectedHost = request.Host
			}
			if err != nil || parsed.Host != expectedHost || (parsed.Scheme != "http" && parsed.Scheme != "https") {
				writeError(writer, http.StatusForbidden, "origin_mismatch", "Request origin was rejected.")
				return
			}
		}
		next.ServeHTTP(writer, request)
	})
}

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
