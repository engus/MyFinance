# Milestone 6 — FX cache and dashboard

This delivery turns the Dashboard into a read-only view of the immutable ledger. It never changes
financial data and it never fabricates a conversion when a cached FX rate does not exist.

## Delivered

- Dated Yahoo FX cache for the 24 supported currencies, represented as USD-based quote snapshots.
- A replaceable provider interface, bounded HTTP client, latest usable close selection, PostgreSQL
  advisory lock, idempotent upsert, and stale marker when a refresh fails.
- Worker refresh on startup and at the normal worker interval, plus an idempotent trailing 12-month
  backfill for currencies actually used by accounts or display settings. Transient provider failures
  retry with bounded exponential backoff; a failed provider does not block session cleanup,
  recurring generation, or the rest of the worker cycle.
- Dashboard API with net worth, assets, liabilities, cash, monthly income, expenses, net savings,
  savings rate, net-worth history, cashflow history, manual asset allocation, and currency exposure.
- Historical cashflows use the latest snapshot on or before the financial event date; current
  balances use the latest cached snapshot. Missing values are excluded and surfaced as INCOMPLETE;
  stale cached data is surfaced as STALE.
- Dashboard UI with real charts and explicit loading, error, empty, stale, and missing-rate states.

## Intentional boundary

FX conversion does not rewrite the posted ledger and no manual FX entry is introduced. Existing
future transaction entry flows continue to use their posted functional snapshots. Automated security
quotes, ticker positions, and liabilities remain outside v1.

## Verification

```sh
make generate
make db-migrate
make db-migrate-test
TEST_DATABASE_URL='postgres://myfinance:myfinance@127.0.0.1:5433/myfinance_test?sslmode=disable' go test ./internal/httpapi -run TestDashboardUsesLedgerFlowsAndExcludesTransfersIntegration -count=1
go test ./internal/fx
```
