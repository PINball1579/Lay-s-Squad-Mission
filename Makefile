SHELL := /bin/sh
.DEFAULT_GOAL := help

GOCACHE ?= $(CURDIR)/.cache/go-build
GOMODCACHE ?= $(CURDIR)/.cache/go-mod
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?= $(shell command -v chromium 2>/dev/null)
export GOCACHE GOMODCACHE PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH

.PHONY: help install dev stop migrate test test-backend test-integration test-frontend lint build verify e2e-install e2e

help:
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "%-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install reproducible frontend and backend dependencies
	cd frontend && npm ci
	cd backend && go mod download

dev: ## Build and start PostgreSQL, API, and web app
	docker compose up --build -d

stop: ## Stop local services without deleting the database volume
	docker compose down

migrate: ## Apply versioned PostgreSQL migrations
	docker compose run --rm migrate

test: test-backend test-frontend ## Run unit and component tests

test-backend: ## Run Go tests with race detection
	cd backend && go test -race ./...

test-integration: ## Run PostgreSQL persistence and concurrency integration tests
	docker compose up -d db migrate
	cd backend && TEST_DATABASE_URL='postgres://crunch:crunch-local-only@127.0.0.1:5432/crunch_squad?sslmode=disable' go test -race ./internal/httpapi ./internal/storage/postgres -count=1

test-frontend: ## Run React component tests
	cd frontend && npm test

lint: ## Run Go formatting checks, vet, and ESLint
	test -z "$$(gofmt -l backend)"
	cd backend && go vet ./...
	cd frontend && npm run lint

build: ## Build API and production frontend
	cd backend && go build ./cmd/api
	cd frontend && npm run build

e2e: ## Run Playwright journeys against the local Compose stack
	docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"' < infrastructure/reset-demo.sql
	cd frontend && npm run e2e

e2e-install: ## Install Playwright Chromium for first-time E2E use
	cd frontend && npx playwright install chromium

verify: test lint build ## Run all non-E2E verification

