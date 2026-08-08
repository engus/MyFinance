# ADR 0005: manual valuations are ledgered snapshots

## Status

Accepted.

## Decision

An asset profile has exactly one user-owned asset ledger account. A submitted valuation is an
append-only dated snapshot containing total market value, calculated owned value, prior ledger
balance, and adjustment. A non-zero adjustment posts a balanced `REVALUATION` transaction between
the asset account and the system Unrealized gain/loss equity account.

The value form accepts the total market value, not a pre-calculated personal share. Ownership is
stored with two decimal places and applied by PostgreSQL numeric arithmetic at the eight-decimal
money scale.

## Consequences

Buying an asset can move cash to the asset account without changing net worth. Later valuation
changes do change the asset account and are independently auditable. Historical snapshots are never
rewritten; a correction is another snapshot. Manual portfolios use the same mechanism and do not
imply security positions or external prices.
