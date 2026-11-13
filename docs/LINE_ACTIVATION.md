# Activate LINE login, camera scanning, and coupons

The application code supports real LINE accounts and receipt photo verification.
Public activation needs an HTTPS website and a LINE Login channel/LIFF app
created in the campaign owner's LINE Developers account. Local development can
continue with `MOCK_LIFF=true` until those are available.

No domain yet? Use the [temporary HTTPS test setup](LINE_TESTING.md) to test
real LINE accounts and receipt photos on your phone first.

## LINE Developers setup

1. Create a LINE Login channel under your provider. Enable web app login.
2. Add a LIFF app to that channel. Set its endpoint to your public HTTPS app
   URL, choose Full view, and enable `openid` and `profile` scopes. Enable the
   share target picker if invitation sharing will be used.
   Link the campaign Official Account from the same provider and configure
   `LINE_CHANNEL_ACCESS_TOKEN` for completion cards. See [LINE messages](LINE_MESSAGES.md).
3. Add the required callback/endpoint settings for that channel and register
   developer/tester accounts while the channel is in development status.
4. Set `MOCK_LIFF=false`, `VITE_LIFF_ID` to the LIFF app ID, and
   `LINE_CHANNEL_ID` to its parent Login channel ID. Set `ALLOWED_ORIGIN` to
   the exact HTTPS origin and `SECURE_COOKIES=true`. Supply fresh production
   database and secret values through the deployment's secret manager.
5. Rebuild both containers: frontend configuration is baked into the bundle.
6. Open `https://liff.line.me/YOUR_LIFF_ID` on iOS and Android. Confirm sign-in,
   invite preservation, consent, squad reopening, and receipt photo selection in both LINE
   and an external browser.

After LINE login returns, the client exchanges the ID token with the backend,
which verifies it directly with LINE. Existing consent and squad state are
restored. Invite tokens survive a login redirect. App sessions remain in
HTTP-only cookies; LINE tokens are not written to browser storage or analytics.

## Receipt photo verification

The fourth mission is now Receipt Hunt. It uses mobile camera/gallery selection
and the backend OpenThai 2.0 OCR Text integration. Configure `IAPP_API_KEY` privately.
The old QR verification endpoint is retired. See [receipt OCR](RECEIPT_OCR.md)
for the current flow, data handling, supported files, and local test commands.

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

## Local receipt check

Run `make e2e` after building the stack to use an isolated synthetic OCR provider
without spending live credits. Actual LINE login and physical phone photo-capture
checks remain necessary once the LIFF app and HTTPS endpoint exist.
