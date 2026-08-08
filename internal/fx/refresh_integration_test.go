package fx

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type fixtureProvider struct {
	snapshot Snapshot
	err      error
}

func (provider fixtureProvider) Fetch(_ context.Context, base, quote string) (Snapshot, error) {
	if provider.err != nil {
		return Snapshot{}, provider.err
	}
	if quote != "KZT" {
		return Snapshot{}, ErrUnavailable
	}
	return provider.snapshot, nil
}

func TestRefreshKeepsLastRateAndMarksOnlyCachedQuotesStaleIntegration(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set; integration database test skipped")
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatalf("connect to test database: %v", err)
	}
	t.Cleanup(pool.Close)

	date := time.Date(2099, time.January, 2, 0, 0, 0, 0, time.UTC)
	if _, err := pool.Exec(context.Background(), `DELETE FROM fx_rates WHERE provider = 'YAHOO' AND base_currency = 'USD' AND quote_currency = 'KZT' AND rate_date = $1`, date); err != nil {
		t.Fatalf("clear test rate: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM fx_rates WHERE provider = 'YAHOO' AND base_currency = 'USD' AND quote_currency = 'KZT' AND rate_date = $1`, date)
	})

	fresh, err := Refresh(context.Background(), pool, fixtureProvider{snapshot: Snapshot{Base: "USD", Quote: "KZT", Rate: "500", Date: date}}, date)
	if err != nil {
		t.Fatalf("refresh fresh quote: %v", err)
	}
	if fresh.Fresh != 1 || fresh.Stale != 0 {
		t.Fatalf("fresh result = %#v, want one fresh and no stale quotes", fresh)
	}

	stale, err := Refresh(context.Background(), pool, fixtureProvider{err: ErrUnavailable}, date.Add(24*time.Hour))
	if err != nil {
		t.Fatalf("refresh unavailable quote: %v", err)
	}
	if stale.Fresh != 0 || stale.Stale != 1 {
		t.Fatalf("stale result = %#v, want only the cached KZT quote marked stale", stale)
	}
	var markedAt *time.Time
	if err := pool.QueryRow(context.Background(), `SELECT stale_at FROM fx_rates WHERE provider = 'YAHOO' AND base_currency = 'USD' AND quote_currency = 'KZT' AND rate_date = $1`, date).Scan(&markedAt); err != nil {
		t.Fatalf("read stale quote: %v", err)
	}
	if markedAt == nil {
		t.Fatal("expected cached quote to be marked stale")
	}
}
