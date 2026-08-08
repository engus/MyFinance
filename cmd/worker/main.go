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
	"github.com/engus/myfinance/internal/fx"
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
		logger.Error("worker_database_configuration_failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	run := func() {
		checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		if err := pool.Ping(checkCtx); err != nil {
			cancel()
			logger.Warn("worker_dependency_unavailable", "dependency", "database", "error", err)
			return
		}
		cancel()
		now := time.Now()
		provider := fx.NewYahooProvider(nil)
		fxCtx, cancelFX := context.WithTimeout(ctx, 45*time.Second)
		fxRefresh, err := fx.Refresh(fxCtx, pool, provider, now)
		cancelFX()
		if err != nil {
			logger.Warn("worker_fx_refresh_failed", "error", err)
		}
		backfillCtx, cancelBackfill := context.WithTimeout(ctx, 45*time.Second)
		fxBackfill, err := fx.BackfillHistory(backfillCtx, pool, provider, now.UTC().AddDate(0, -11, 0), now.UTC())
		cancelBackfill()
		if err != nil {
			logger.Warn("worker_fx_backfill_failed", "error", err)
		}
		workCtx, cancelWork := context.WithTimeout(ctx, 20*time.Second)
		defer cancelWork()
		queries := database.New(pool)
		sessionsDeleted, err := queries.DeleteExpiredSessions(workCtx)
		if err != nil {
			logger.Warn("worker_session_cleanup_failed", "error", err)
			return
		}
		challengesDeleted, err := queries.DeleteExpiredLoginChallenges(workCtx)
		if err != nil {
			logger.Warn("worker_challenge_cleanup_failed", "error", err)
			return
		}
		recurring, err := httpapi.GenerateRecurring(workCtx, pool, time.Now(), 100)
		if err != nil {
			logger.Warn("worker_recurring_generation_failed", "error", err)
			return
		}
		expiredPreviews, err := pool.Exec(workCtx, `
			DELETE FROM reconciliation_previews
			WHERE expires_at < now() AND confirmed_at IS NULL`)
		if err != nil {
			logger.Warn("worker_reconciliation_preview_cleanup_failed", "error", err)
			return
		}
		logger.Info(
			"worker_cycle_complete",
			"expired_sessions_deleted", sessionsDeleted,
			"expired_challenges_deleted", challengesDeleted,
			"recurring_occurrences_generated", recurring.Generated,
			"recurring_lock_acquired", recurring.Locked,
			"expired_reconciliation_previews_deleted", expiredPreviews.RowsAffected(),
			"fx_lock_acquired", fxRefresh.Locked,
			"fx_rates_refreshed", fxRefresh.Fresh,
			"fx_rates_marked_stale", fxRefresh.Stale,
			"fx_backfill_lock_acquired", fxBackfill.Locked,
			"fx_historical_rates_cached", fxBackfill.Fresh,
			"fx_historical_rates_marked_stale", fxBackfill.Stale,
			"version", settings.Version,
		)
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
