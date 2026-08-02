# MyFinance

MyFinance is a private, double-entry household finance application for cashflow, assets,
liabilities, and multi-currency net-worth reporting.

## Requirements

- Node.js 22+
- Docker with Compose
- npm 10+

## Local development

```bash
npm ci
npm run setup
npm run dev
```

`npm run setup` starts isolated development and test PostgreSQL containers, applies the clean
ledger migration, and creates an idempotent demonstration portfolio. The demo login is
`demo@myfinance.local` / `MyFinance-Demo-2026!`; override it with `DEMO_EMAIL` and
`DEMO_PASSWORD` before seeding. If port 5432 is already used, run
`POSTGRES_PORT=5434 npm run setup` and use the same port in `DATABASE_URL` for development.

The web app is available at `http://127.0.0.1:5173`; Vite proxies `/api` to the API at
`http://127.0.0.1:3001`.

To run the complete local product in containers instead, use `docker compose up --build` and open
`http://127.0.0.1:8080`. The default Compose secrets are intentionally development-only.

## Verification

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run e2e
```

`npm test` starts an isolated PostgreSQL service on port 5433 and applies migrations before
running API and web tests.

## Database commands

- `npm run db:migrate` creates a development migration.
- `npm run db:deploy` applies committed migrations.
- `npm run db:seed` creates local demonstration data.

Never use development credentials in production. Production deployment and backup guidance is
documented in `docs/runbook.md`.

## Product surface

- Immutable double-entry operations: income, expense, same/FX transfer, opening balance,
  liability payment, valuation, reversal, and correction.
- Separate recurring templates with idempotent generation and account-scoped reconciliation.
- Twenty-four currencies with dated original/functional values, manual overrides, and optional
  Yahoo FX snapshots.
- Manual assets, monthly total-value investment snapshots, liabilities, and consolidated
  net-worth/cashflow reporting. Tickers, quantities and live security quotes are deferred.
- Password sessions, CSRF protection, TOTP 2FA/recovery codes, session revocation, and account
  deletion.

All financial event dates use `YYYY-MM-DD`. Decimal API values remain JSON strings.

## Production image

```bash
cp .env.production.example .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
```

The public web container listens on port 8080 by default. Put it behind an HTTPS-terminating
reverse proxy. PostgreSQL and the API remain on the internal Docker network; migrations run as a
separate one-shot job.
