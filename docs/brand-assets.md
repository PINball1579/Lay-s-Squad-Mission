# Brand asset replacement guide

The MVP intentionally uses geometric CSS shapes, emoji-like symbols, system fonts, invented flavor labels, and the visible label `PLACEHOLDER ART`. It does not reproduce official packaging or a logo.

Authorized campaign teams can replace the placeholder layer without changing game logic:

1. Add approved files under `frontend/public/brand/` with descriptive, versioned names.
2. Update campaign brand tokens in `tailwind.config.js` or move them into the published campaign configuration.
3. Replace `ChipMark` and mission preview placeholders with accessible `<img>` elements including approved alt text.
4. Replace invented flavor/occasion/claim copy in campaign configuration and seed data only after brand/legal approval.
5. Record asset source, license/authorization owner, approval date, expiry, locale, and checksum in an asset manifest.
6. Keep a neutral fallback so missing/expired assets never show a broken experience.

Do not commit source design files containing restricted assets unless the repository and access policy are approved for them. Do not use scraped images or infer a visual identity from public packaging.

