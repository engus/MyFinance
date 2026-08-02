# Production-readiness requirements matrix

| Area           | Implementation                                                                      | Verification                                         |
| -------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Toolchain      | npm workspaces, no-emit TypeScript, ESLint/Prettier, root commands, CI audit        | `npm run typecheck`, `npm run lint`, `npm run build` |
| Ledger         | clean Prisma schema, decimal FX snapshots, 2+ balanced immutable entries            | ledger integration/property-style cases              |
| Operations     | typed Zod union, atomic create/reverse/replace, cursor filters                      | contracts and ledger/API tests                       |
| Recurring      | separate templates/lines, bounded serializable generation, unique occurrence        | parallel generation test                             |
| Reconciliation | account-scoped schedule generation, AUTO/CONFIRM, stale preview conflict            | reconciliation integration tests                     |
| Authentication | normalized atomic registration, sessions, credentials, deletion, TOTP/recovery      | auth/security and HTTP tests                         |
| Web product    | English responsive shell, onboarding, cashflow, assets, settings, state components  | component tests and Playwright desktop/mobile        |
| Assets/debt    | profiles, manual/idempotent value snapshots, principal+interest payments            | integration tests                                    |
| Reporting      | net worth, KPI, 12-month flows, allocation/exposure, dated FX fallback              | dashboard component/integration coverage             |
| Production     | non-root multi-stage images, internal network, Nginx, migration job, runbook/backup | Docker build, healthchecks, smoke suite              |

## Explicitly deferred

Google OAuth, email verification/reset, native applications, household roles, theme switching,
bank/broker imports, tax lots, full amortization schedules, and automated property/vehicle pricing.
Ticker-level security positions, quantities, average cost, and live security quotes are also
deferred; investments are tracked as manually valued total positions.
