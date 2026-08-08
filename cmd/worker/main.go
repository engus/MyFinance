package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/engus/myfinance/internal/config"
	"github.com/engus/myfinance/internal/database"
)

func main() {
	settings := config.Load()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: settings.LogLevel}))
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := database.Open(ctx, settings.DatabaseURL)
	if err != nil {
		logger.Error("worker_database_configuration_failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	run := func() {
		checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if err := pool.Ping(checkCtx); err != nil {
			logger.Warn("worker_dependency_unavailable", "dependency", "database", "error", err)
			return
		}
		logger.Info("worker_cycle_complete", "jobs", 0, "version", settings.Version)
	}

	logger.Info("worker_started", "environment", settings.Environment, "interval", settings.WorkerInterval.String())
	run()

	ticker := time.NewTicker(settings.WorkerInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logger.Info("worker_stopped")
			return
		case <-ticker.C:
			run()
		}
	}
}
