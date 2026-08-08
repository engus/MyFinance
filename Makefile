.DEFAULT_GOAL := help

GO_TOOLCHAIN := go1.25.12

.PHONY: help dev down build test lint typecheck format format-check generate generate-go generate-client generate-sql db-migrate db-migrate-test db-down db-seed audit clean ci

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*##"; printf "MyFinance commands:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  %-18s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

dev: ## Build and start the full local application
	docker compose up --build

down: ## Stop local services and keep database volumes
	docker compose down

build: ## Build the frontend, API, and worker
	npm run build
	GOTOOLCHAIN=$(GO_TOOLCHAIN) go build ./cmd/...

test: ## Run frontend and Go tests
	npm test
	GOTOOLCHAIN=$(GO_TOOLCHAIN) go test ./cmd/... ./internal/...

lint: ## Run JavaScript/TypeScript lint and Go vet
	npm run lint
	GOTOOLCHAIN=$(GO_TOOLCHAIN) go vet ./cmd/... ./internal/...

typecheck: ## Type-check the frontend
	npm run typecheck

format: ## Format TypeScript, JSON, Markdown, YAML, and Go
	npm run format
	GOTOOLCHAIN=$(GO_TOOLCHAIN) gofmt -w cmd internal openapi

format-check: ## Verify repository formatting
	npm run format:check
	test -z "$$(GOTOOLCHAIN=$(GO_TOOLCHAIN) gofmt -l cmd internal openapi)"

generate: generate-go generate-client generate-sql ## Regenerate OpenAPI and sqlc outputs

generate-go: ## Generate Go OpenAPI models and chi bindings
	GOTOOLCHAIN=$(GO_TOOLCHAIN) go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.0 --config openapi/oapi-codegen.yaml openapi/openapi.yaml

generate-client: ## Generate the TypeScript OpenAPI schema
	npm run generate:client

generate-sql: ## Generate typed database queries with sqlc
	GOTOOLCHAIN=$(GO_TOOLCHAIN) go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0 generate

db-migrate: ## Apply database migrations
	docker compose run --rm migrate

db-migrate-test: ## Apply migrations to the isolated test database
	docker compose run --rm migrate-test

db-down: ## Roll back one database migration
	docker compose run --rm migrate -path=/migrations -database=postgres://$${POSTGRES_USER:-myfinance}:$${POSTGRES_PASSWORD:-myfinance}@postgres:5432/$${POSTGRES_DB:-myfinance}?sslmode=disable down 1

db-seed: ## Apply the idempotent development seed
	docker compose exec -T postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -f /seed/dev.sql'

audit: ## Audit production JavaScript and Go dependencies
	npm run audit:prod
	GOTOOLCHAIN=$(GO_TOOLCHAIN) go run golang.org/x/vuln/cmd/govulncheck@v1.6.0 ./cmd/... ./internal/...

clean: ## Remove generated build and coverage output
	npm run clean --workspace @myfinance/web

ci: format-check lint typecheck test build ## Run all non-container CI checks
