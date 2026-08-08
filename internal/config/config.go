package config

import (
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

const defaultDatabaseURL = "postgres://myfinance:myfinance@127.0.0.1:5432/myfinance?sslmode=disable"

type Config struct {
	Environment         string
	Version             string
	APIPort             int
	DatabaseURL         string
	LogLevel            slog.Level
	WorkerInterval      time.Duration
	SessionTTL          time.Duration
	SessionCookieSecure bool
}

func Load() Config {
	return Config{
		Environment:         getString("APP_ENV", "development"),
		Version:             getString("APP_VERSION", "dev"),
		APIPort:             getInt("API_PORT", 8080),
		DatabaseURL:         getString("DATABASE_URL", defaultDatabaseURL),
		LogLevel:            getLogLevel("LOG_LEVEL", slog.LevelInfo),
		WorkerInterval:      getDuration("WORKER_INTERVAL", 24*time.Hour),
		SessionTTL:          getDuration("SESSION_TTL", 30*24*time.Hour),
		SessionCookieSecure: getBool("SESSION_COOKIE_SECURE", false),
	}
}

func getString(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func getInt(key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil || value < 1 {
		return fallback
	}
	return value
}

func getDuration(key string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(strings.TrimSpace(os.Getenv(key)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func getBool(key string, fallback bool) bool {
	value, err := strconv.ParseBool(strings.TrimSpace(os.Getenv(key)))
	if err != nil {
		return fallback
	}
	return value
}

func getLogLevel(key string, fallback slog.Level) slog.Level {
	var level slog.Level
	if err := level.UnmarshalText([]byte(strings.ToLower(strings.TrimSpace(os.Getenv(key))))); err != nil {
		return fallback
	}
	return level
}
