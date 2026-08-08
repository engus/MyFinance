# Milestone 3 — immutable ledger and Cashflow

This delivery turns onboarding setup into the only financial source of truth: a balanced,
append-only PostgreSQL journal exposed through typed operations and the responsive Cashflow UI.

## Delivered

- Exact `numeric(24,8)` original and functional amounts with immutable FX source/date snapshots.
- Deferred database checks requiring every committed transaction to be posted, contain at least two
  entries, and sum to zero in functional currency.
- Database triggers preventing mutation or deletion of posted transactions and entries while still
  allowing password-confirmed whole-account deletion.
- Private user accounts, system equity/income/expense accounts, and income/expense category-backed
  ledger accounts.
- Atomic onboarding materialisation and account creation with optional opening balance.
- Typed opening-balance, income, expense, same-currency transfer, and asset-purchase commands; raw
  debit/credit entries are not part of the public API.
- Reversal and atomic reversal-plus-replacement corrections that preserve the original operation.
- Account/category create, rename, archive, and restore APIs with ownership isolation.
- Account-currency and functional-currency locks after the relevant first posting.
- Date/account/category/type filtering and stable `(event_date, id)` cursor pagination.
- Responsive Cashflow transaction history, exact-string entry forms, operation correction/reversal,
  account/category management, and explicit loading, empty, error, and archived states.
- Idempotent demo ledger data for opening balance, salary, rent, groceries, and a savings transfer.

## Intentional boundary

Milestone 3 accepts only operations whose account currencies match the user's functional currency.
Different-currency operations return `fx_rate_unavailable` until the dated Yahoo FX cache is added
in Milestone 6. The application never guesses a rate and v1 has no manual FX entry.

Recurring generation and reconciliation remain Milestone 4. Assets and monthly manual valuation
snapshots remain Milestone 5. Automated security quotes, ticker positions, tax lots, and liabilities
are not part of v1.

## Verification

```sh
make generate
make db-migrate
make db-migrate-test
make db-seed
TEST_DATABASE_URL='postgres://myfinance:myfinance@127.0.0.1:5433/myfinance_test?sslmode=disable' make test
make ci
```

The PostgreSQL integration suite covers onboarding materialisation, idempotent typed operations,
exact balances, reversal and replacement, cursor pagination, immutable entry rejection, cross-user
access, account currency locks, and functional currency locks.

Browser acceptance is performed against the real Vite-to-Go proxy at the default desktop viewport
and `390×844`. Cashflow has no document-level horizontal overflow; its mobile operation history
collapses to cards and the account strip remains intentionally swipeable.
