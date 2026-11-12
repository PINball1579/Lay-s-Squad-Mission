# Lay's Crunch Squad implementation plan

Status: implementation plan for an unofficial, placeholder-only MVP.

## Architecture

The system is a modular monolith. The React LIFF client calls a versioned Go REST API. The API separates HTTP handlers, game services, repositories, domain models, and LINE/QR adapters. PostgreSQL is the system of record; an in-memory repository is retained for fast unit tests and an explicitly selected local demo mode. A single deployment unit keeps transactions around squad membership, role claims, completions, inventory, and unlocks.

```text
LINE/Browser -> React + LIFF adapter -> Go REST API -> service layer -> PostgreSQL
                                  \-> mock adapter       \-> LINE verify endpoint
                                                         \-> signed QR adapter
Admin browser -----------------------> protected admin API/dashboard
```

## Domain and database model

- Identity: `users`, `line_identities`, `sessions`, `consent_records`.
- Campaign: `campaigns`, versioned `campaign_configs`, `roles`, `missions`.
- Cooperation: `squads`, `squad_members`, `role_assignments`, `invitations`.
- Missions: `mission_attempts`, `mission_completions`, `qr_locations`.
- Rewards: `rewards`, `reward_inventory`, `reward_unlocks`, `reward_redemptions`.
- Governance: `analytics_events`, `admin_users`, `audit_logs`.

Hard invariants are implemented twice: domain checks produce useful errors, and database constraints/transactions prevent races. Important uniqueness rules cover one active campaign membership, one squad member per role, one completion per assignment, one unlock per squad, and one redemption per entitlement.

## State machines

```text
Squad:       forming -> active -> completed -> reward_unlocked
Membership:  active  -> left
                    \-> replaced (explicit admin/campaign transition)
Assignment:  claimed -> in_progress -> completed
Invitation:  active  -> used | expired | revoked
Reward:      locked  -> unlocked -> redeemed
```

A squad completes only when all configured unique roles have a completion. Reward creation is part of the same transaction and protected by a unique squad constraint. Completion endpoints require an idempotency key.

## API contract

All routes are under `/api/v1`; `docs/openapi.yaml` is authoritative.

- Auth/session: `POST /auth/mock`, `POST /auth/line`, `POST /auth/logout`, `GET /me`.
- Consent/config: `PUT /consent`, `GET /campaign`.
- Squads: `POST /squads`, `POST /squads/join`, `GET /squads/{id}`, `POST /squads/{id}/leave`.
- Invitations/roles: `POST /squads/{id}/invitations`, `POST /squads/{id}/roles/{role}`.
- Missions/QR: `GET /missions/{role}`, `POST /squads/{id}/missions/{role}/complete`, `POST /qr/validate`.
- Rewards: `GET /squads/{id}/reward`, `POST /squads/{id}/reward/redeem`.
- Analytics: `POST /events`; admin metrics, CSV export, and campaign configuration under `/admin`.

Opaque sessions are rotated on authentication and stored server-side. Mutations require a session plus CSRF token. Real LINE authentication accepts only an ID token, verifies it server-side, and derives the LINE subject from the verified response.

## Event taxonomy

The event names and allowed properties are in `docs/analytics-events.md`. Events carry a server timestamp, campaign and session context, consent state, and pseudonymous identifiers only when permitted. Raw tokens and profile payloads are prohibited. Required operational/audit events are separated from optional behavioral analytics.

## Delivery phases

1. Define migrations, OpenAPI, configuration, and brand/privacy boundaries.
2. Test-first implementation of squad, role, mission, QR, reward, and analytics rules.
3. Add secure mock and real LINE adapters.
4. Build the mobile player flow and all four template-driven missions.
5. Add admin analytics/configuration, audit logging, and CSV export.
6. Add Compose, seed content, unit/component/integration/E2E tests, then run security/concurrency review and verification.

## External prerequisites and adapters

- Real LIFF requires a LIFF ID and LINE Login channel ID supplied through environment settings.
- Authorized campaign assets, product claims, privacy/terms URLs, and reward inventory must be supplied by the campaign owner.
- Production QR signing requires a secret held outside source control.
- The MVP uses labeled geometric placeholder assets, four mock LINE users, signed local QR fixtures, and mock rewards.

