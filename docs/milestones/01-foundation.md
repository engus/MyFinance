# Milestone 1 — Local platform foundation

## Delivered

- React 19, TypeScript, Vite 7.3, Tailwind CSS, React Router, and TanStack Query.
- Approved Calm Ledger shell with reusable card, button, loading, error, and empty states.
- Go 1.25.12 API and worker using `chi`, `pgx/v5`, structured `slog` output, request IDs, and
  graceful shutdown.
- OpenAPI 3.1 as the source of truth with generated Go server bindings and TypeScript schema types.
- PostgreSQL 17.10 development and isolated test databases with explicit migrations and generated
  sqlc bindings.
- Idempotent foundation seed, loopback-only Adminer, healthchecks, and one-command Docker Compose
  startup.
- Root generation, format, lint, typecheck, test, build, migration, seed, and audit commands.
- GitHub Actions validation using Node 24.15 and Go 1.25.12.

## Verification

```sh
make generate
make ci
make audit
docker compose config --quiet
docker compose up --build --detach
make db-seed
```

The browser acceptance pass covers Dashboard, Cashflow, Assets, and Settings at 1440×1000 and
390×844. The API readiness indicator must show `Ready`, both PostgreSQL instances must be healthy,
and both migration jobs must exit with status zero.

## Deferred by design

Authentication, the demo user, onboarding, financial tables, ledger operations, reconciliation,
assets, FX collection, and production packaging belong to later milestones in `plan.md`.
