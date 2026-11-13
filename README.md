# Lay's Crunch Squad

[![CI](https://github.com/PINball1579/Lay-s-Squad-Mission/actions/workflows/ci.yml/badge.svg)](https://github.com/PINball1579/Lay-s-Squad-Mission/actions/workflows/ci.yml)

A mobile-first Thai cooperative LIFF campaign experience. Four LINE users form a squad, lock unique roles, complete four different missions, and unlock a team reward. The campaign interface includes a responsive landing page, team roster, mission states, invite sharing, and a Thai operations dashboard. Local mode retains explicit test accounts, QR fixtures, and reward inventory for repeatable testing. See [campaign handoff](docs/CAMPAIGN_HANDOFF.md) for the confirmed coupon direction and the remaining hosting, LIFF, asset, and fulfillment setup.

## Repository layout

```text
frontend/        React, TypeScript, Vite, Tailwind, Vitest, Playwright
backend/         Go REST API, domain services, LINE and QR adapters
migrations/      versioned PostgreSQL schema and local QA seed
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

The default local stack keeps PostgreSQL inside the Compose network, avoiding conflicts with an existing database on ports 5432/5433. Only the web app (`5173`) and API (`8080`) are published to the host.

Managed cloud builds that require an injected proxy CA use the opt-in overlay:

```sh
docker compose -f docker-compose.yml -f docker-compose.cloud.yml up --build -d
```

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

## Local QA journey

1. Sign in as a mock user and accept required consent. Optional analytics may remain off.
2. Create a squad and copy/share its invitation link.
3. Open the invitation link in separate private browser contexts. Each invited player chooses an identity, accepts consent, and is joined automatically without re-entering a code.
4. Lock each unique role and complete its mission.
   - **Crunch Hunter:** find all configured differences in the two shelf images before time expires.
   - **Flavor Referee:** choose through a 16-flavor persisted Flavor Cup; the full bracket is revealed only after a champion is crowned.
   - **Snack Detective** and **QR Runner:** retain their existing journeys.
5. Use `mock:demo-store` for QR Runner.
6. The fourth idempotent completion unlocks the local fixture reward.
7. Review consent-filtered metrics in `/admin`.

Crunch Hunt images, normalized hotspots, timer, hints, and scoring and Flavor Cup flavors, descriptions, images, bracket size, `seedOrder`, `placementMode` (`random` or `alternate`), and share-card tokens are stored in migration-backed mission configuration. Replace the placeholder asset URLs/configuration without changing React or Go code. The persisted role codes remain `flavor_scout` and `crunch_creator` solely to preserve historical assignments, completions, and analytics.

Invitation URLs expose Open Graph and Twitter Card metadata so public HTTPS deployments render a rich preview when links are pasted into LINE and other compatible apps. Localhost URLs cannot be fetched by external preview crawlers. Flavor Cup reference photography is bundled locally from Wikimedia Commons; source and license details are in `frontend/public/missions/products/README.md`.

## Real LINE mode

Follow [LINE activation](docs/LINE_ACTIVATION.md) for the complete channel/LIFF setup, real camera QR issuance, and coupon inventory/reveal flow.

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

The browser experience, API, domain rules, PostgreSQL repository, migrations, local seed, analytics dashboard, mocks, automated tests, dependency updates, and CI release gates are implemented. Compose runs PostgreSQL as the system of record; the in-memory implementation remains available only when mock mode is explicitly enabled and `DATABASE_URL` is absent. Public launch still requires hosting, official LINE credentials, final authorized campaign artwork, approved Thai legal copy, real reward fulfillment rules, and managed infrastructure supplied by the campaign owner.

