# Activate LINE login, camera scanning, and coupons

The application code supports real LINE accounts and signed activity QR codes.
Public activation needs an HTTPS website and a LINE Login channel/LIFF app
created in the campaign owner's LINE Developers account. Local development can
continue with `MOCK_LIFF=true` until those are available.

## LINE Developers setup

1. Create a LINE Login channel under your provider. Enable web app login.
2. Add a LIFF app to that channel. Set its endpoint to your public HTTPS app
   URL, choose Full view, and enable `openid` and `profile` scopes. Enable the
   share target picker if invitation sharing will be used.
3. Add the required callback/endpoint settings for that channel and register
   developer/tester accounts while the channel is in development status.
4. Set `MOCK_LIFF=false`, `VITE_LIFF_ID` to the LIFF app ID, and
   `LINE_CHANNEL_ID` to its parent Login channel ID. Set `ALLOWED_ORIGIN` to
   the exact HTTPS origin and `SECURE_COOKIES=true`. Supply fresh production
   database and secret values through the deployment's secret manager.
5. Rebuild both containers: frontend configuration is baked into the bundle.
6. Open `https://liff.line.me/YOUR_LIFF_ID` on iOS and Android. Confirm sign-in,
   invite preservation, consent, squad reopening, and scanning in both LINE
   and an external browser.

After LINE login returns, the client exchanges the ID token with the backend,
which verifies it directly with LINE. Existing consent and squad state are
restored. Invite tokens survive a login redirect. App sessions remain in
HTTP-only cookies; LINE tokens are not written to browser storage or analytics.

## Real activity QR codes

QR Runner tries `liff.scanCodeV2()` when supported. Otherwise it opens the
browser camera using ZXing, requests the rear camera, and decodes QR frames
locally. HTTPS and camera permission are required. Manual token entry remains
available. Camera streams stop when the scanner closes, succeeds, or unmounts.

The QR content must be a signed token, not an arbitrary store name or URL.
Configure an active `qr_locations.code` in the campaign first. On a trusted
operator machine with the same `QR_SIGNING_SECRET` as the API:

```sh
cd backend
go run ./cmd/qr -location YOUR_LOCATION_CODE -ttl 24h \
  | ../frontend/node_modules/.bin/qrcode -t svg -o /tmp/activity-qr.svg
```

Install frontend dependencies first with `npm ci` to provide the QR image
encoder. Distribute only the resulting QR image. Never place the signing
secret in the frontend or send it to an online QR generator. Expired or modified
tokens are rejected by the API, and proof remains bound to the player session
and current QR mission attempt. `mock:` tokens are rejected in live mode.

## Coupon inventory and reveal

Inventory allocation is already transactional: completing the squad reserves
one `reward_inventory` row. Claiming marks that row claimed; the authenticated
reward endpoint then reveals its `inventory_key` as the coupon code. The popup
can be reopened after refresh, and all current squad members see the same code.
It does not generate a new coupon on every click. Codes are absent from general
squad responses and analytics; the reveal response uses `Cache-Control: no-store`.

Before activating a live campaign, create an active reward with `kind='coupon'`
and import actual issuer-provided coupon codes into its inventory. Deactivate
the seeded `digital_mock` reward. Only load unused codes, keeping issuer value,
expiry, store restrictions, and settlement rules in your approved campaign terms.
Do not commit live codes to Git. The seeded `MOCK-` codes are test fixtures;
the popup explicitly labels them as unusable for purchases.

## Repeatable local camera check

With the Compose stack running and FFmpeg installed:

```sh
cd frontend
PLAYWRIGHT_CAMERA_FILE="$(node scripts/create-camera-fixture.mjs)" \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run e2e
```

This feeds a signed QR image through Chromium's camera input and real ZXing
decoding. The full journey verifies server validation, reward unlock, coupon
reveal, clipboard feedback, refresh/reopen, and outsider denial. Use fresh local
QA data before each full journey. Actual LINE account and physical phone checks
remain necessary after the owner supplies the LIFF app and HTTPS endpoint.
