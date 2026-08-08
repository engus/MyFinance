# Milestone 4 — recurring operations and reconciliation

This delivery automates predictable Cashflow operations and lets a user replace exhaustive expense
tracking with auditable month-end account balances.

## Delivered

- Typed recurring templates for income, expense, and same-currency transfer operations.
- Weekly, monthly, quarterly, yearly, and custom day/week/month schedules with explicit start and
  optional end dates.
- Timezone-aware generation with month-end anchoring, leap-year handling, bounded batches,
  transaction-scoped advisory locking, row locking, and a unique `(template, scheduled date)`
  occurrence guard.
- Automatic template pausing when an account or category it depends on is archived.
- A Cashflow Recurring workspace for creation, editing, pause/resume, archive/restore, and
  dependency warnings while keeping decimal amounts as strings.
- Reconciliation status by period and active bank/cash account, including month completion state.
- A soft global reminder from five days before month-end through the fifth day of the next month in
  the user's timezone; reconciliation itself remains available at any time.
- CONFIRM mode with an expiring preview and locked balance recheck, plus atomic AUTO mode.
- Derived Other Expense for negative differences and Other Income for positive differences.
- Multi-month gap metadata and a clear warning that the full difference belongs to the latest
  selected period.
- Immutable corrections: a repeated reconciliation reverses the previous adjustment, supersedes the
  prior record, and posts the corrected adjustment in one database transaction.
- Idempotent demo salary/rent templates and completed previous-month snapshots.

## Integrity model

Recurring generation is queue-like work. The worker first acquires a transaction advisory lock, then
claims due templates with `FOR UPDATE SKIP LOCKED`. A deterministic idempotency key and the
occurrence uniqueness constraint are the final duplicate guards.

Reconciliation previews are advisory, not authority. Confirmation locks the account, recomputes its
period-end ledger balance, and returns `409 preview_stale` if the ledger changed. Repeated confirms
and AUTO submissions with the same idempotency key return the existing result instead of posting a
second adjustment.

## Intentional boundary

Milestone 4 reconciles active bank, debit-card, and cash accounts in the user's functional currency.
The dated FX cache arrives in Milestone 6, so the application never guesses a rate. Asset profiles
and manual valuation snapshots—including manually entered securities-portfolio values—arrive in
Milestone 5. Automated security quotes, ticker positions, tax lots, and liabilities remain outside
v1.

## Verification

```sh
make generate
make db-migrate
make db-migrate-test
make db-seed
TEST_DATABASE_URL='postgres://myfinance:myfinance@127.0.0.1:5433/myfinance_test?sslmode=disable' make ci
make audit
docker compose config --quiet
docker compose up --build --detach
```

The PostgreSQL suite runs recurring generation and AUTO reconciliation concurrently, verifies
duplicate protection and archive cascades, rejects stale previews, confirms positive/negative
adjustments, and checks reversal-based replacement and month completion. Unit tests cover anchored
calendar schedules, leap years, custom intervals, the reconciliation window, and multi-month gaps.

Frontend tests cover exact-decimal template and reconciliation submissions. Browser acceptance is
performed against the real Vite-to-Go proxy at desktop and `390×844` mobile viewports, including
empty/loading/error states, navigation, dialog keyboard behavior, and document-level overflow.
