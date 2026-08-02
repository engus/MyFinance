# Security and data-integrity review

Review date: 2026-08-02

## Security controls

- Passwords and recovery-sensitive credentials use Argon2id or one-way SHA-256 hashes as
  appropriate; session and challenge tokens are stored only as hashes.
- TOTP secrets use AES-256-GCM with a mandatory production key. Login challenges expire, are
  single-use, have an attempt ceiling, and sit behind endpoint rate limits.
- Authentication cookies are HTTP-only, SameSite=Lax, and `Secure`/`__Host-` in production.
  Mutations require a per-session CSRF token.
- CSP, frame, MIME, referrer, and permissions headers are set on every response. Request bodies are
  limited, trusted proxy behavior is opt-in, and errors use one non-leaking envelope.
- Ownership predicates are present in user-scoped reads and writes. Account deletion removes
  dependent journals, schedules, manual rates, and profiles in one ordered transaction, then uses
  cascading foreign keys for the remaining user-owned rows. Password re-authentication and TOTP
  are required when enabled.
- Production containers run as non-root. PostgreSQL/API are not published outside the internal
  network; HTTPS termination is explicitly delegated to an external proxy.

## Ledger invariants

- A posted transaction is never updated or deleted through the public API. Correction and deletion
  commands create linked reversals; the original remains queryable.
- Each transaction contains at least two lines, every line targets exactly one account/category,
  and functional amounts must sum exactly to zero at 8-decimal precision before insertion.
- Original currency, functional currency, FX rate, source, and value date are frozen on every line.
- Account currency and user functional currency are locked after the first relevant posting.
- Account/category archive operations pause dependent schedules. Foreign keys restrict deletion of
  referenced ledger targets.
- Recurring occurrence uniqueness and serializable claim/update prevent duplicate scheduled
  postings. Reconciliation confirms against both account version and balance under a transaction.
- Valuations are unique by asset/date/source; FX rates are owner-scoped dated snapshots with
  manual data taking priority for the corresponding date.

## Residual risks and operations

- Yahoo FX is an unauthenticated best-effort provider and may change or throttle its endpoint.
  Manual fallback is a required product path. Investment values are manual total-position
  snapshots only.
- CSP currently permits inline styles because chart heights are rendered as React style values.
  No untrusted HTML rendering exists; removing `style-src 'unsafe-inline'` is a future hardening
  opportunity.
- Availability, encrypted off-host backup, host patching, TLS configuration, and runtime alerting
  belong to the deployment operator and are documented in the runbook.
