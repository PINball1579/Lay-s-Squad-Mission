# Campaign handoff

## Confirmed direction

The experience is a Thai, four-person Lay's squad campaign. Flavor Cup uses
16 flavors. Coupons are the proposed reward; the campaign owner has not yet
chosen the value or fulfillment terms. A public website and LINE LIFF app will
be created after the project review.

## Implemented and testable locally

- Responsive campaign landing page, mission overview, and team creation.
- Invitation sharing/copying with feedback and automatic invite consumption.
- Persistent squad membership, one role per member, completion and reward records.
- Crunch Hunt, persistent 16-flavor Flavor Cup, Snack Detective, and Receipt Hunt.
- Team roster, completed-task state, progress, and reward confirmation.
- Consent choices and Thai operations dashboard with CSV export.
- Production LINE authentication adapter, signed QR validation, CSRF/session
  protection, transactional reward reservation, migrations, and build checks.

## Required before accepting public participants

1. Choose the public HTTPS domain and provision hosting and PostgreSQL backups.
2. Create the LINE Login channel and LIFF app. Configure `VITE_LIFF_ID`,
   `LINE_CHANNEL_ID`, `ALLOWED_ORIGIN`, and `SECURE_COOKIES=true`; disable
   `MOCK_LIFF` and replace the local development secrets. Rebuild the frontend.
3. Supply distinct approved product images for all 16 flavors. Current photos
   are temporary reference images and are reused across flavors. Replace the
   URLs in a new versioned mission configuration; preserve existing attempts.
4. Approve the final shelf artwork and its normalized difference coordinates.
   The current shelf is an illustration with five playable differences.
5. Specify coupon value, issuer, stock, expiry, participating stores, eligibility,
   and redemption channel. Load real inventory and connect fulfillment; the
   current local reward records are fixtures and do not issue usable coupons.
6. Publish the approved Thai participation terms and privacy notice, including
   controller/contact information and retention/deletion details. Existing copy
   explains the implemented data flow but is not a complete campaign notice.
7. Run the real LINE login, share picker, receipt photo/OCR, reopen/resume, coupon,
   and pasted-link preview journey on actual iOS and Android devices.

Rich link previews require a publicly reachable URL. Localhost is intended for
development; external services cannot fetch its metadata. The local account
chooser and QR fixture remain explicitly marked as testing tools.
