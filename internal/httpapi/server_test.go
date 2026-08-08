package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLiveness(t *testing.T) {
	handler := NewHandler(NewServer(nil, "test-version"), slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/health/live", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("X-Request-ID") == "" {
		t.Fatal("expected response request ID")
	}

	var body map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["status"] != "ok" || body["version"] != "test-version" {
		t.Fatalf("unexpected response: %#v", body)
	}
}

func TestReadinessUsesErrorEnvelopeWhenDatabaseIsMissing(t *testing.T) {
	handler := NewHandler(NewServer(nil, "test-version"), slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/health/ready", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Error.Code != "database_unavailable" {
		t.Fatalf("unexpected error response: %#v", body)
	}
}

func TestEmbeddedOpenAPIDocument(t *testing.T) {
	handler := NewHandler(NewServer(nil, "test-version"), slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodGet, "/api/openapi.json", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var body struct {
		OpenAPI string `json:"openapi"`
		Info    struct {
			Title string `json:"title"`
		} `json:"info"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.OpenAPI != "3.1.0" || body.Info.Title != "MyFinance API" {
		t.Fatalf("unexpected OpenAPI document: %#v", body)
	}
}
