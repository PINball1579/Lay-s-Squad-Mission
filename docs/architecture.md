# Architecture decisions

## ADR-001: Modular monolith

**Decision:** Use one Go API deployment and one PostgreSQL database. Domain services sit between HTTP and repository adapters.

**Why:** Squad joining, unique role claims, four-way completion, inventory reservation, and reward unlock require strong transactions. Microservices would add distributed consistency risk without MVP value.

## ADR-002: Server-derived LINE identity

**Decision:** The frontend sends a LIFF ID token; the backend verifies it at LINE Login v2.1 and derives the internal user from the verified subject.

**Why:** Frontend profile/user IDs are attacker-controlled. LINE-specific code stays behind adapters so mock mode is deterministic.

## ADR-003: Consent-aware first-party analytics

**Decision:** Allowlist event names and separate required operational records from optional behavioral analytics. Remove user IDs and properties from required-only records.

**Why:** Players must be able to decline analytics and still play. Data minimization reduces privacy risk.

## ADR-004: Signed QR tokens and idempotent rewards

**Decision:** Production QR codes carry versioned, signed, expiring location claims. Mission and redemption mutations require idempotency keys and database uniqueness.

**Why:** Raw location codes are forgeable; retries and concurrent clients must not duplicate entitlements.

## ADR-005: Template-generated creative cards

**Decision:** Render cards from approved template options in the browser; do not require generative AI or user uploads.

**Why:** This is deterministic, fast in LIFF, easier to moderate, and avoids unnecessary file/security/privacy scope.

## ADR-006: PostgreSQL system of record

**Decision:** Compose and production-shaped execution use a transactional PostgreSQL adapter. A concurrency-safe in-process implementation remains for unit tests and an explicitly selected mock fallback only.

**Consequence:** Game state survives API restarts and role/reward races are enforced by both transactions and constraints. PostgreSQL availability is required outside explicit mock fallback mode.

