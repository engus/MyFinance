package config

import (
	"log/slog"
	"testing"
	"time"
)

func TestLoadUsesEnvironmentAndSafeFallbacks(t *testing.T) {
	t.Setenv("APP_ENV", "test")
	t.Setenv("APP_VERSION", "abc123")
	t.Setenv("API_PORT", "9090")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("LOG_LEVEL", "debug")
	t.Setenv("WORKER_INTERVAL", "30m")

	got := Load()

	if got.Environment != "test" || got.Version != "abc123" {
		t.Fatalf("unexpected identity config: %#v", got)
	}
	if got.APIPort != 9090 || got.DatabaseURL != "postgres://example" {
		t.Fatalf("unexpected service config: %#v", got)
	}
	if got.LogLevel != slog.LevelDebug || got.WorkerInterval != 30*time.Minute {
		t.Fatalf("unexpected runtime config: %#v", got)
	}

	t.Setenv("API_PORT", "invalid")
	t.Setenv("WORKER_INTERVAL", "invalid")

	fallback := Load()
	if fallback.APIPort != 8080 || fallback.WorkerInterval != 24*time.Hour {
		t.Fatalf("invalid values should use defaults: %#v", fallback)
	}
}
