# Milestone 5 — assets and manual valuations

This delivery gives MyFinance a deliberately manual wealth layer. A person records the value they
know; the application stores both the immutable snapshot and the balanced ledger effect.

## Delivered

- Profiles for real estate, vehicles, businesses, manual securities portfolios, collectibles, and
  other assets.
- Geography, institution, ownership percentage, notes, linked account, archive state, and currency
  on every profile.
- A dedicated asset ledger account is created automatically, or an existing private asset account
  can be linked once.
- Optional purchase flow that moves an exact amount from a cash/asset account into the created asset
  in the same serializable transaction.
- Dated manual values. The submitted amount is the total market value; the profile's ownership share
  determines the owned value.
- One immutable `REVALUATION` journal per non-zero change, against the system Unrealized gain/loss
  equity account. A zero-value valuation is allowed and records the write-down without inventing a
  second entry.
- Valuations are append-only and cannot be backdated before the latest snapshot. Correct a value by
  posting a newer snapshot for the same date.
- Assets UI with current total, allocation, profile cards, archive/restore, a purchase form, and
  valuation history.
- Seeded demo apartment with a manual value snapshot.

## Intentional boundary

`SECURITIES` means a manually valued portfolio only. There are no tickers, broker imports, quote
providers, positions, tax lots, automated prices, or liabilities in this milestone. FX conversion is
also deferred, so profile and funding-account currencies must equal the functional currency.

## Verification

```sh
make generate
make db-migrate
make db-migrate-test
make db-seed
TEST_DATABASE_URL='postgres://myfinance:myfinance@127.0.0.1:5433/myfinance_test?sslmode=disable' go test ./internal/httpapi -run TestManualAssetsAndValuationsIntegration -count=1
```

The integration test covers a funded 50%-owned asset, positive and negative revaluations,
out-of-order valuation rejection, allocation totals, and archive cascade to the linked account.
