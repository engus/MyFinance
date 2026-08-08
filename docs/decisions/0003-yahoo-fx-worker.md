# ADR 0003: Replaceable Yahoo FX worker

- Status: Accepted for v1
- Date: 2026-08-08

## Context

The dashboard must convert 24 supported currencies without requiring manual FX entry or an API key.
Yahoo Finance endpoints are sufficient for low-volume development but are not a guaranteed public
application contract.

## Decision

Implement Yahoo Finance behind an `FXProvider` interface. A separate worker process runs once on
startup and daily thereafter. It stores normalised USD-based dated snapshots and backfills
historical dates on demand.

The worker must:

- use bounded retries with backoff and request jitter;
- cache every successful response;
- use a PostgreSQL advisory lock to prevent overlapping jobs;
- upsert idempotently by provider, base currency, quote currency, and rate date;
- use the latest prior rate when a market-date rate is unavailable;
- mark cached data stale after a failed refresh;
- expose missing-rate status instead of inventing a value.

Live Yahoo requests are forbidden in automated tests. Provider fixtures cover normal, malformed,
stale, and unavailable responses.

## Consequences

- Yahoo can be replaced later without changing ledger or dashboard contracts.
- A missing first-ever quote prevents complete converted totals but never prevents original-currency
  data entry.
- The UI must make stale and incomplete totals visible.
