# Milestone 2 — demo login slice

This scoped delivery makes the requested development credentials usable without presenting the whole
Identity milestone as complete.

## Included

- Normalized email identities and Argon2id password hashes.
- Random browser session tokens with only their SHA-256 digests stored in PostgreSQL.
- HttpOnly, SameSite session cookies and server-side logout revocation.
- Login throttling, strict JSON input bounds, and non-specific invalid-credential errors.
- Generated OpenAPI/TypeScript/sqlc contracts for login, logout, and current-user lookup.
- Protected React routes, responsive Calm Ledger sign-in UI, and an explicit logout action.
- An idempotent development seed for `demo@myfinance.local`.

## Deferred within Milestone 2

- Registration and full onboarding.
- TOTP setup/login, recovery codes, and backup code rotation.
- Email/password editing, session list/revocation, and account deletion.
- Durable/distributed rate limits and the full authentication audit trail.

The final Milestone 2 pull request must complete these items and its original acceptance criteria.

## Audit note

`govulncheck` reports `GO-2026-5932` at module level because `golang.org/x/crypto` contains the
deprecated `openpgp` package. MyFinance imports `x/crypto/argon2`, not `openpgp`; the scan reports
zero symbol-level and zero imported-package vulnerabilities. There is no fixed module version for
this advisory, so the required Argon2id dependency is retained and the unused package is not linked
into either binary.
