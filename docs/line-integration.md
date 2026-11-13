# LINE/LIFF integration notes

The real adapter is isolated from mock mode. The frontend uses the current `@line/liff` package and these supported calls:

1. `liff.init({ liffId, withLoginOnExternalBrowser: false })`; external login starts after the player taps the LINE button.
2. `liff.isLoggedIn()` and user-initiated `liff.login()` when needed.
3. `liff.getIDToken()`; the ID token is sent to the backend. The frontend never sends a trusted LINE user ID.
4. The backend posts `id_token` and `client_id` to LINE Login v2.1 verification and accepts the verified `sub` only after audience and expiration checks.
5. `liff.getProfile()` is optional display enrichment and is never an authentication authority.
6. `liff.isApiAvailable('shareTargetPicker')` and `liff.shareTargetPicker()` run directly after a tap, with the invitation prepared in advance. A confirmed share sends a Flex card; cancellation and unavailability are distinct results. Link copying is an explicit mock-mode QA action only.
7. The fourth mission uses receipt photos and server-side OpenThai OCR; the former QR verification route is retired.
8. After a saved completion, the backend verifies the player's LINE identity and requests a Thai Flex notification through the linked Official Account's Messaging API. Failed delivery leaves the mission complete. Accepted delivery IDs persist to prevent repeat sends. See [LINE messages](LINE_MESSAGES.md) for account setup, tests, and delivery limitations.

The app now automatically exchanges a returned LINE ID token when its own app session is absent, then restores consent and squad state. Invitation intent is retained through external login. See [activation instructions](LINE_ACTIVATION.md).

Official references reviewed for these integrations:

- <https://developers.line.biz/en/docs/liff/developing-liff-apps/>
- <https://developers.line.biz/en/reference/liff/>
- <https://developers.line.biz/en/docs/line-login/verify-id-token/>
- <https://developers.line.biz/en/docs/liff/developing-liff-apps/#share-target-picker>
- <https://developers.line.biz/en/reference/messaging-api/#send-push-message>

Physical LINE accounts and the linked Official Account are required to verify
actual chat delivery. Automated tests cover API contracts, identity binding,
deduplication, picker cancellation, and invitation redirects without messaging
real users.

