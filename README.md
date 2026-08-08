# MyFinance

MyFinance is a privacy-conscious personal finance web application for understanding cashflow and net
worth without recording every purchase. The application is being rebuilt milestone by milestone from
the specification in [`promt.md`](promt.md) and the delivery plan in [`plan.md`](plan.md).

This branch contains the local platform foundation: a React/Vite frontend, Go API and worker,
PostgreSQL, OpenAPI-generated contracts, sqlc bindings, structured logs, health endpoints, and the
approved Calm Ledger visual system.

## Start locally

Requirements:

- Docker Desktop with Docker Compose v2
- `make`

Start every local service with one command:

```sh
make dev
```

Docker Compose builds the application, starts PostgreSQL 17, applies migrations, and waits for the
API readiness check before starting the frontend.

| Service         | Local address                               |
| --------------- | ------------------------------------------- |
| Web application | <http://127.0.0.1:5173>                     |
| API liveness    | <http://127.0.0.1:8080/api/v1/health/live>  |
| API readiness   | <http://127.0.0.1:8080/api/v1/health/ready> |
| OpenAPI JSON    | <http://127.0.0.1:8080/api/openapi.json>    |
| Adminer         | <http://127.0.0.1:8081>                     |
| PostgreSQL      | `127.0.0.1:5432`                            |
| Test PostgreSQL | `127.0.0.1:5433`                            |

Adminer is intentionally bound to loopback and is for development only. Its default server is
`postgres`; use the credentials from `.env.example`.

Stop services without deleting database data:

```sh
make down
```

## Development commands

Copy `.env.example` to `.env` only when you need to override local defaults. The committed defaults
are safe for local development and are never production credentials.

```sh
make generate     # regenerate Go/TypeScript OpenAPI and sqlc code
make db-migrate   # apply migrations
make db-migrate-test # apply migrations to the isolated test database
make db-seed      # apply the idempotent development seed
make audit        # audit production JavaScript and Go dependencies
make format       # format Go and frontend files
make lint         # ESLint plus go vet
make typecheck    # TypeScript compiler
make test         # Vitest plus go test
make build        # Vite plus Go binaries
make ci           # all non-container checks
```

Host-side frontend commands require Node.js 24.15 or newer (`nvm use`). Host-side Go commands
automatically use the pinned Go 1.25.12 toolchain. Docker remains the supported path when those
tools are not installed locally.

## Repository layout

```text
apps/web/          React frontend and Calm Ledger UI primitives
cmd/api/           Go HTTP API entrypoint
cmd/worker/        Background worker entrypoint
db/                SQL migrations, sqlc queries, and development seed
docs/decisions/    Accepted architecture and product decisions
internal/          Go application packages and generated bindings
openapi/           OpenAPI 3.1 source of truth
pages_preview/     Approved and historical visual references
```

## Current milestone boundary

The foundation deliberately has no authentication or financial tables yet. The next milestone adds
registration, secure sessions, optional TOTP, onboarding, and the idempotent demo user. Ledger,
reconciliation, assets, FX, and complete dummy financial history follow in their dedicated
milestones.
