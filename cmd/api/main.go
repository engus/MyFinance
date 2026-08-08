package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/engus/myfinance/internal/config"
	"github.com/engus/myfinance/internal/database"
	"github.com/engus/myfinance/internal/httpapi"
)

func main() {
	settings := config.Load()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: settings.LogLevel}))
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := database.Open(ctx, settings.DatabaseURL)
	if err != nil {
		logger.Error("database_configuration_failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	server := &http.Server{
		Addr: fmt.Sprintf(":%d", settings.APIPort),
		Handler: httpapi.NewHandler(
			httpapi.NewServer(
				pool,
				settings.Version,
				httpapi.WithSessionConfig(settings.SessionTTL, settings.SessionCookieSecure),
			),
			logger,
		),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("api_started", "environment", settings.Environment, "port", settings.APIPort, "version", settings.Version)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			logger.Error("api_shutdown_failed", "error", err)
			os.Exit(1)
		}
		logger.Info("api_stopped")
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("api_failed", "error", err)
			os.Exit(1)
		}
	}
}
