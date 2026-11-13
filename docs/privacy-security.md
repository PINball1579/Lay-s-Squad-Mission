# Privacy and security considerations

## Data minimization and consent

The service creates an internal pseudonymous identity from the verified LINE subject. Raw LINE ID/access tokens, full profile payloads, QR signing keys, reward secrets, and administrator credentials must never enter analytics. Required processing covers identity, squad state, fraud prevention, and reward integrity. Optional behavioral analytics has a separate consent flag and declining it does not block game play.

Flavor Cup selections are observed campaign interactions, not confirmed purchase intent. Crunch Hunt stores normalized tap coordinates for a tap heatmap; this is not eye tracking. Neither dataset may be used to infer health, ethnicity, religion, age, or other sensitive characteristics.

Retention periods, subject access/deletion procedures, campaign controller identity, international transfer language, and legal basis require campaign-owner and counsel approval before real use.

Receipt Hunt sends a player-selected image to iApp/OpenThai only after explicit
processing confirmation. The app does not persist receipt images or extracted
text; a SHA-256 digest and verification metadata remain with the mission record.
Receipt contents and hashes must not be placed in analytics or application logs.
The campaign notice must disclose iApp as the OCR processor. See
[receipt OCR](RECEIPT_OCR.md) for limits and the implemented matching rule.

## Threat model and controls

| Risk | MVP control | Production follow-up |
| --- | --- | --- |
| Forged LINE identity | backend verifies ID token and trusts verified `sub` only | monitor verification failures; rotate channel config |
| Session theft/fixation | random tokens hashed in PostgreSQL, login rotation, expiry/revocation, HttpOnly/SameSite session cookie | user-facing session/device revocation UI |
| CSRF/CORS abuse | per-session CSRF token and exact origin | verify reverse-proxy origin/header policy |
| Invitation guessing | 256-bit random token and expiry | store token hash and add revocation/use telemetry |
| Concurrent role claim | PostgreSQL row transaction, unique constraints, conflict mapping | load/soak testing and contention alerts |
| Duplicate completion/reward | idempotency key, database uniqueness, transactional inventory reservation | stable client retry keys and reconciliation alerts |
| Forged mission completion | 15-minute server-issued attempt bound to the authenticated assignment and consumed transactionally | behavioral abuse monitoring and adaptive challenge content |
| Forged QR | HMAC-SHA256 signed expiry/location/nonce plus durable proof binding to the active attempt, assignment, campaign location, and authenticated session | managed signing keys, rotation/versioning, replay monitoring |
| Inventory overspend | `SELECT ... FOR UPDATE SKIP LOCKED` and atomic reservation | inventory reconciliation and depletion alerts |
| Analytics overcollection | allowlisted event names and consent filter | schema/property registry and retention jobs |
| Admin misuse | separate token-protected API and audit schema | SSO/MFA/RBAC, immutable audit sink |

## Secrets

Only `.env.example` is committed. Its values are labeled local-only. Real secrets must be injected at runtime from an environment secret manager. Logs must not contain tokens, cookie values, request bodies from auth routes, signing material, or unredacted remote verification responses.

## Production blockers

- Add managed PostgreSQL backups, recovery drills, connection monitoring, and migration rollback procedures.
- Replace local administrator token auth with SSO, MFA, RBAC, and durable audit logging.
- Add HTTPS, secure cookies, managed secret rotation, backups, monitoring, retention/deletion jobs, and an incident plan.
- Perform an authorized penetration test and privacy/legal review.

