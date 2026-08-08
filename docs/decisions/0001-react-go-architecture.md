# ADR 0001: React frontend with a Go API

- Status: Accepted
- Date: 2026-08-08

## Context

MyFinance needs a rich browser interface, an explicit financial domain model, a background
FX/recurrence worker, and a stable API foundation for possible mobile clients. The first release is
local-only, but the service boundaries should remain suitable for later deployment.

## Decision

Use a React and TypeScript single-page application with a separate Go REST API. OpenAPI 3.1 is the
contract source for generated Go server types and the TypeScript client.

Use one Go codebase with two commands:

- `api` serves `/api/v1`;
- `worker` runs recurring-operation and FX jobs.

Both commands share domain services and PostgreSQL transactions. They are separate local containers
but not separate repositories or independently owned microservices.

## Consequences

- Financial rules are explicit and independent from the browser.
- Future web and mobile clients can use the same API.
- Frontend and backend use different languages, so OpenAPI generation is mandatory.
- Local development has multiple processes; Docker Compose and root Make targets hide that
  complexity.
- A Next.js server layer is intentionally not introduced.
