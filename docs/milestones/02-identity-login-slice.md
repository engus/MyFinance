# Milestone 2 — identity, security, and onboarding

This delivery completes the account journey from registration through financial onboarding and
security management. The earlier demo-login slice remains preserved in Git history.

## Delivered

- Atomic registration with normalized email and Argon2id password hashing.
- Random server-side sessions stored only as SHA-256 token digests and delivered via HttpOnly,
  SameSite cookies.
- Optional RFC 6238 TOTP with an AES-256-GCM encrypted secret, replay prevention, a five-attempt
  login challenge, and ten one-use SHA-256-hashed recovery codes.
- Login and registration throttling, strict JSON bounds, CSRF origin/fetch-metadata checks, security
  headers, request IDs, structured logs, and persisted authentication audit events.
- Profile and email editing, password changes that revoke other sessions, session review/revocation,
  and password-confirmed account deletion.
- Responsive registration, second-factor login, onboarding, and security/settings UI with all copy
  in the localisation resource.
- Atomic onboarding for timezone, functional/display currencies, reconciliation mode, first account,
  opening balance, and optional monthly income.
- An isolated PostgreSQL integration database and tests for ownership isolation, duplicate
  onboarding, encrypted TOTP storage, one-use recovery codes, and deletion cascades.
- An idempotent development seed for `demo@myfinance.local` plus first-account and income setup
  data.

## Ledger boundary

Onboarding balances and income are stored as explicit setup records with `ledger_posted_at` and
`materialized_at` markers. Milestone 3 will atomically convert them into immutable opening-balance
and recurring ledger operations. This prevents a temporary pseudo-ledger from becoming a second
source of truth.

Functional currency remains editable until the first transaction is posted. The Milestone 3 database
constraint and service rules will lock it after that point. Durable distributed rate limits are
deferred until horizontal API scaling is introduced; the current limiter is intentionally process
local and challenges also enforce a database attempt cap.

## Verification

```sh
make db-migrate
make db-migrate-test
make db-seed
TEST_DATABASE_URL='postgres://myfinance:myfinance@127.0.0.1:5433/myfinance_test?sslmode=disable' make test
make ci
make audit
```

The demo credentials are `demo@myfinance.local` / `DemoFinance2026!`.

Browser acceptance was run through the real Vite-to-Go proxy at desktop and 390px mobile widths:
registration, decimal-preserving onboarding, account-class switching, preference updates, session
listing, logout, and demo login all completed without horizontal overflow or browser console errors.

The final Milestone 2 pull request must complete these items and its original acceptance criteria.

## Audit note

`govulncheck` reports `GO-2026-5932` at module level because `golang.org/x/crypto` contains the
deprecated `openpgp` package. MyFinance imports `x/crypto/argon2`, not `openpgp`; the scan reports
zero symbol-level and zero imported-package vulnerabilities. There is no fixed module version for
this advisory, so the required Argon2id dependency is retained and the unused package is not linked
into either binary.
