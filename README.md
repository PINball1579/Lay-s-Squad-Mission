# Lay's Crunch Squad

[![CI](https://github.com/PINball1579/Lay-s-Squad-Mission/actions/workflows/ci.yml/badge.svg)](https://github.com/PINball1579/Lay-s-Squad-Mission/actions/workflows/ci.yml)

An unofficial, mobile-first cooperative LIFF campaign MVP. Four mock LINE users form a squad, claim unique roles, complete four different missions, and unlock one mock reward. The repository contains no official Lay's logos, packaging, fonts, product claims, coupons, or production credentials.

> All artwork and rewards are clearly labeled placeholders. This project is not affiliated with or endorsed by Lay's or LINE.

## Repository layout

```text
frontend/        React, TypeScript, Vite, Tailwind, Vitest, Playwright
backend/         Go REST API, domain services, LINE and QR adapters
migrations/      versioned PostgreSQL schema and demo seed
docs/            plan, OpenAPI, events, integration, privacy, brand guidance
infrastructure/  deployment notes and production checklist
```

## Quick start

Prerequisites: Docker with Compose v2. Copy `.env.example` to `.env` only when you need to change the local defaults.

```sh
docker compose up --build -d
docker compose ps
curl -fsS http://localhost:8080/healthz
```

Open `http://localhost:5173`. Choose Mali, Nok, Beam, or Ploy. The local admin dashboard is at `http://localhost:5173/admin`; its default local-only token is documented in `.env.example`.

Stop services without deleting the database:

```sh
docker compose down
```

## Local commands

```sh
make install          # npm ci and go mod download
make test             # Go race tests and React component tests
make test-integration # PostgreSQL persistence and role-race test
make lint             # gofmt check, go vet, ESLint
make build            # Go and production frontend builds
make migrate          # repeatable versioned migrations
make e2e-install      # one-time Playwright Chromium install
make e2e              # reset local demo data, then run Playwright against Compose
make verify           # tests, lint, and builds
```

Go 1.27 and Node 24 are the pinned container toolchains. Local Go caches can be redirected with `GOCACHE` and `GOMODCACHE` if the home directory is read-only.

## Demo journey

1. Sign in as a mock user and accept required consent. Optional analytics may remain off.
2. Create a squad and share/copy the expiring invitation.
3. Open separate private browser contexts for the other three mock users and join.
4. Claim each unique role and complete its mission.
5. Use `mock:demo-store` for QR Runner.
6. The fourth idempotent completion unlocks one `Mock Crunch Badge`.
7. Review consent-filtered metrics in `/admin`.

## Real LINE mode

Set `MOCK_LIFF=false`, `VITE_LIFF_ID`, `LINE_CHANNEL_ID`, HTTPS `ALLOWED_ORIGIN`, `SECURE_COOKIES=true`, and fresh 32+ byte random values for `QR_SIGNING_SECRET`, `PSEUDONYM_KEY`, and `ADMIN_API_TOKEN`. Never use the local values outside a developer machine.

The frontend initializes the official `@line/liff` SDK, requests login when needed, sends only `liff.getIDToken()` to the backend, and uses `shareTargetPicker`/`scanCodeV2` only when available and after user action. See [LINE integration](docs/line-integration.md).

Production also requires:

- authorized campaign assets and reviewed product/campaign claims;
- approved privacy notice, terms, campaign dates, locations, and inventory;
- a secret manager and TLS termination;
- managed PostgreSQL backups, point-in-time recovery, and operational monitoring;
- an administrator identity provider in place of the local API token;
- rate limiting at the edge and centralized audit/log retention.

## Security model

- LINE subjects are accepted only from LINE's server-side verification response and pseudonymized internally.
- Sessions are opaque, hashed in PostgreSQL, rotated on login, and carried in HTTP-only SameSite cookies; CSRF tokens are independently hashed and required on mutations.
- CORS is an exact-origin allowlist and request bodies are size-limited with unknown fields rejected.
- Invitations use 256-bit random tokens and expiry. QR tokens are HMAC-signed and expiring; verified proofs are persisted against the exact attempt, assignment, campaign location, and authenticated session. Mock tokens work only in mock mode.
- Role claims, short-lived assignment-bound mission attempts, completion consumption, inventory reservation, and reward unlocks use PostgreSQL transactions, row locks, and database constraints.
- Analytics honors optional consent and never accepts raw authentication tokens.
- Client errors are generic; detailed causes remain server-side.

See [privacy and security considerations](docs/privacy-security.md) and the [OpenAPI contract](docs/openapi.yaml).

## Current MVP boundary

The browser experience, API, domain rules, PostgreSQL repository, migrations, demo seed, analytics dashboard, mocks, automated tests, dependency updates, and CI release gates are implemented. Compose runs PostgreSQL as the system of record; the in-memory implementation remains available only when mock mode is explicitly enabled and `DATABASE_URL` is absent. No production deployment is included because hosting, official LINE credentials, authorized assets, legal approval, and managed infrastructure are external campaign-owner decisions.

