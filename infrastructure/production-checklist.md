# Production checklist

- [ ] Obtain campaign authorization, approved assets, product claims, privacy notice, terms, dates, and rewards.
- [ ] Create LIFF/LINE Login channels and restrict callback/origin settings.
- [x] Wire the PostgreSQL repository and run race/concurrency integration tests against PostgreSQL 16.
- [x] Gate main and pull requests with unit, lint, build, PostgreSQL integration, browser journey, and container-build CI jobs.
- [ ] Configure managed secrets, TLS, secure cookies, SSO/MFA/RBAC, audit retention, backups, and monitoring.
- [ ] Rotate QR signing versions and define replay/revocation rules.
- [ ] Load-test join, role claim, fourth completion, and reward inventory contention.
- [ ] Complete accessibility, LIFF device/client matrix, privacy, legal, security, and brand reviews.
- [ ] Replace all placeholder labels and mock rewards only with authorized content.

