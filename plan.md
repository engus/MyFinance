# MyFinance v1 — Clean Rebuild Plan

## Summary

MyFinance is a privacy-conscious personal finance web application for people who want to understand
cashflow and net worth without recording every purchase.

The user records accounts, known income, known expenses, and month-end balances. Reconciliation
derives unexplained spending as `Other Expense`. Assets are tracked separately through manual
valuation snapshots. All accounting uses immutable double-entry transactions.

The old application remains available only through Git history. The rebuild is delivered through one
reviewed pull request per milestone.

## Progress tracker

| Milestone                             | Branch                             | Status                                  |
| ------------------------------------- | ---------------------------------- | --------------------------------------- |
| 0 — Specification and design          | `codex/rebuild-00-spec-design`     | Complete                                |
| 1 — Local platform foundation         | `codex/rebuild-01-foundation`      | Complete                                |
| 2 — Identity, security, onboarding    | `codex/rebuild-02-identity`        | Complete; PR #4 merged                  |
| 3 — Ledger and Cashflow               | `codex/rebuild-03-ledger-cashflow` | Acceptance passed; PR #5 review pending |
| 4 — Recurring and Reconciliation      | `codex/rebuild-04-reconciliation`  | Queued                                  |
| 5 — Assets and valuations             | `codex/rebuild-05-assets`          | Queued                                  |
| 6 — FX worker and Dashboard           | `codex/rebuild-06-fx-dashboard`    | Queued                                  |
| 7 — Data ownership and release review | `codex/rebuild-07-local-release`   | Queued                                  |

Update this table in every milestone PR. A milestone is marked complete only after its acceptance
checks pass; PR review/merge remains the gate for beginning the next branch.

## Product rules

### Cashflow and reconciliation

- Users create bank, debit-card, and cash accounts with an opening balance and account currency.
- Users record known income, expenses, transfers, and asset purchases.
- Operations may be one-off or recurring. Recurring operations post automatically and can later be
  reversed or corrected.
- For each reconciled account, `difference = reported month-end balance - ledger balance`.
- A negative difference creates `Other Expense`; a positive difference creates `Other Income`.
- Accounts can be reconciled independently. A month is incomplete until all active accounts are
  reconciled.
- A soft reconciliation prompt appears from five calendar days before month-end through the fifth
  day of the following month in the user's timezone.
- Reconciliation remains available at any time. Balances entered in the window are assigned to the
  target month's last calendar day.
- If several months were skipped, the entire unexplained difference is assigned to the latest
  reconciled month and marked as covering a multi-month gap.
- The application derives total unexplained spending but does not invent detailed spending
  categories.

### Accounting

- Every posted transaction has at least two entries and balances in the user's functional currency.
- Opening balances, income, expenses, transfers, asset purchases, reconciliation adjustments,
  revaluations, and reversals use typed operations.
- Posted operations are immutable. Editing or deleting creates a reversal and, when applicable, a
  corrected replacement.
- Account currency is locked after its first posting.
- Functional currency is locked after the user's first posting; display currency remains changeable.
- Monetary values and FX rates are decimal strings at every public boundary; binary floating-point
  values are forbidden for accounting.
- An asset purchase is a cash outflow for monthly savings metrics while the ledger moves value from
  cash into an asset. It reduces liquid savings but does not immediately destroy net worth.

### Metrics

- `Total income`: income operations plus derived Other Income.
- `Total expenses`: ordinary expenses, derived Other Expense, and asset-purchase cash outflows;
  internal transfers are excluded.
- `Net savings`: total income minus total expenses.
- `Savings rate`: net savings divided by total income; unavailable when income is zero.
- `Net worth`: reconciled cash balances plus the latest manual asset valuations. Liabilities are
  deferred from v1.

### Assets

Manual asset profiles support real estate, vehicles, businesses, manually valued securities
portfolios, collectibles, and other assets. Each profile stores currency, country, region,
institution, ownership percentage, notes, and dated valuation history.

Automated security prices, ticker positions, tax lots, and liabilities are out of scope for v1.

### Currency and FX

Supported currencies are:

`USD, EUR, JPY, GBP, CNY, AUD, CAD, CHF, HKD, SGD, SEK, KRW, NOK, NZD, INR, MXN, TWD, ZAR, BRL, DKK, KZT, RUB, UAH, AED`.

- One immutable functional currency is used for accounting.
- One changeable display currency is used for dashboards.
- A separate Go worker fetches Yahoo Finance currency data on startup and once daily, stores dated
  snapshots, and performs historical backfills on demand.
- Yahoo access is isolated behind a provider interface because its unofficial endpoints may change
  or become unavailable.
- The worker caches successful results, retries with backoff, and uses a PostgreSQL lock to prevent
  duplicate concurrent jobs.
- A failed refresh uses the last available rate and marks it stale. If no rate exists, converted
  totals exclude the affected value and show an explicit warning.
- Manual FX entry is not included in v1.

### Security and ownership

- One account manages one family's finances in v1; household invitations and roles are deferred.
- Email/password authentication uses Argon2id.
- Sessions use random server-side tokens stored as hashes and delivered through HttpOnly, SameSite
  cookies.
- Mutations use CSRF protection.
- Optional TOTP 2FA uses encrypted secrets and hashed recovery codes.
- Login and TOTP endpoints are rate limited.
- Users can review and revoke sessions, change email/password, export data, and delete the account
  after password confirmation.
- Full export is available as JSON plus resource-specific CSV files.
- Logs never contain passwords, tokens, TOTP secrets, or financial values.
- Authentication, financial corrections, and administrative access produce audit events.
- Development Adminer binds only to `127.0.0.1`, allows full table CRUD, and is never included in a
  production configuration.

### Visual system

- The accepted direction is `Calm Ledger`.
- Use a light neutral canvas, white elevated surfaces, navy typography, indigo primary actions, and
  restrained semantic green, red, and amber states.
- Desktop uses a sidebar; mobile uses bottom navigation.
- English UI copy is centralised in localisation resources from the first React component.
- All screens include visible keyboard focus and explicit loading, empty, error, stale-data, and
  reconciliation states.
- A theme or design-variant switch is out of scope.

## Technical foundation

- Frontend: React 19, TypeScript, Vite 7.3, React Router, TanStack Query, React Hook Form, Zod,
  Tailwind CSS, and Recharts.
- Backend: Go 1.25.x, `chi`, OpenAPI 3.1, `pgx/v5`, `sqlc`, SQL migrations, and decimal arithmetic.
- Database: PostgreSQL 17 on the latest 17.x patch.
- Tooling: Node.js 24 LTS, npm, Docker Compose, Makefile, and GitHub Actions.
- OpenAPI is the source of truth. Go server types and the TypeScript client are generated from it.
- Local services: `web`, `api`, `worker`, `postgres`, `postgres-test`, and loopback-only `adminer`.
- The browser uses one frontend origin; Vite proxies `/api/v1` to Go during development.
- Financial dates use `YYYY-MM-DD`; technical timestamps use UTC RFC 3339.
- API errors use `{ "error": { "code", "message", "fields?" } }`.
- Collections use cursor pagination.

Core records include users, sessions, TOTP credentials, accounts, categories, transactions, entries,
recurring templates and occurrences, balance snapshots, reconciliations, assets, valuations, FX
snapshots, and audit events.

## Milestones

### Milestone 0 — Reset, specification, and design

Branch: `codex/rebuild-00-spec-design`

- Commit the existing deletion of the old application while preserving Git history.
- Preserve `pages_preview`; rewrite `promt.md` in English.
- Add architecture and accounting decision records.
- Explore two browser-viewable desktop/mobile variants based on the existing visual direction.
- Cover the app shell, Dashboard, Cashflow, Reconciliation, Assets, and Settings.
- Implement `Calm Ledger` as the selected visual system.

Acceptance: the specification has no unresolved product decisions and the `Calm Ledger` mockups are
approved.

### Milestone 1 — Local platform foundation

Branch: `codex/rebuild-01-foundation`

- Scaffold the React frontend, Go API and worker, OpenAPI contract, and PostgreSQL migrations.
- Add `make dev`, `test`, `lint`, `generate`, `seed`, and `down`.
- Start all local services with Docker Compose; expose Adminer only on localhost.
- Add health endpoints, structured logs, request IDs, English documentation, and CI.
- Establish localisation resources, design tokens, and reusable UI primitives.

Acceptance: a clean checkout starts locally with one command; builds, linting, and healthchecks
pass.

### Milestone 2 — Identity, security, and onboarding

Branch: `codex/rebuild-02-identity`

- Registration, login/logout, secure sessions, TOTP, recovery codes, and rate limits.
- Account/profile editing, session revocation, and password-confirmed deletion.
- Onboarding for timezone, currencies, accounts, opening balances, and recurring income.
- Idempotent demo seed and isolated test database.

Acceptance: the complete auth/onboarding journey works on desktop and mobile, and ownership
isolation tests pass.

### Milestone 3 — Ledger and Cashflow

Branch: `codex/rebuild-03-ledger-cashflow`

- Implement the immutable balanced ledger and typed operations.
- Add accounts, categories, opening balances, income, expenses, transfers, and asset-purchase
  outflows.
- Build Cashflow UI, filters, pagination, and reversal-based edit/delete.
- Lock account and functional currencies after first posting.

Acceptance: every successful transaction balances, cross-user access fails, and the manual Cashflow
journey is complete.

### Milestone 4 — Recurring operations and Reconciliation

Branch: `codex/rebuild-04-reconciliation`

- Automatic recurring generation with duplicate protection.
- Soft reconciliation window and in-app reminder.
- Partial account reconciliation, month completion state, and multi-month backfill.
- Other Income/Expense adjustments, preview, and safe replacement through reversal.
- Worker concurrency locks and calendar/timezone edge handling.

Acceptance: parallel generation and reconciliation create no duplicates, and all period rules are
covered by tests.

### Milestone 5 — Assets and valuations

Branch: `codex/rebuild-05-assets`

- Asset profiles with geography, institution, ownership, and notes.
- Manual valuation history and revaluation ledger entries.
- Asset-purchase flow linking a cash outflow to a created asset.
- Asset allocation and net-worth inputs without liabilities or ticker-level securities.

Acceptance: asset acquisition affects cash savings and net worth according to the agreed model.

### Milestone 6 — FX worker and Dashboard

Branch: `codex/rebuild-06-fx-dashboard`

- Yahoo FX adapter, daily worker, historical backfill, and dated cache.
- Convert historical flows with event-date rates and current balances with latest rates.
- Stale and missing-rate states.
- Dashboard KPIs and charts for cashflow, savings, net worth, allocation, and currency exposure.

Acceptance: all 24 currencies work with cached fixtures, and provider failure never corrupts ledger
data.

### Milestone 7 — Data ownership and local release review

Branch: `codex/rebuild-07-local-release`

- JSON/CSV export, final deletion flow, and audit views.
- Complete demo data for multiple currencies, reconciliation gaps, and manual assets.
- Accessibility review, responsive browser screenshots, and Playwright end-to-end coverage.
- Security/data-integrity review, local runbook, and requirements matrix.
- Final PR review with all prior milestones merged.

Acceptance: clean local startup, green CI, successful end-to-end financial journey, and no
undocumented security or integrity findings.

## Test plan

- Unit: decimal arithmetic, ledger mappings, savings formulas, recurrence rules, reconciliation
  windows, timezone edges, and FX conversion.
- Property: every posted transaction balances in functional currency.
- Integration: ownership isolation, immutable history, reversals, currency locks, partial
  reconciliation, and account deletion.
- Concurrency: recurring generation, reconciliation replacement, and FX jobs remain idempotent.
- Provider: successful refresh, stale cache, missing cache, malformed Yahoo response, and historical
  backfill.
- Frontend: onboarding, Cashflow, Reconciliation, Assets, loading/error/empty states, and keyboard
  accessibility.
- E2E: register → optional TOTP → onboarding → opening balances → recurring income → expense →
  reconciliation → multi-month gap → asset purchase/valuation → dashboard → export → deletion.

## Delivery rules and exclusions

- One pull request is used per milestone. The next milestone begins only after the previous PR is
  reviewed, green, and merged.
- Every PR includes an English changelog, verification commands, and desktop/mobile screenshots when
  UI changes.
- All UI copy and documentation are English. UI strings live in localisation resources from the
  first component.
- Yahoo tests use stored fixtures; CI never depends on live Yahoo access.
- Production deployment and production admin are outside this roadmap.
- Also deferred: liabilities, Google authentication, email verification/reset, bank and broker
  imports, automatic security quotes, mobile apps, household roles, additional UI languages, dark
  theme, and manual FX rates.
