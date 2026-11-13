# LINE/LIFF integration notes

The real adapter is isolated from mock mode. The frontend uses the current `@line/liff` package and these supported calls:

1. `liff.init({ liffId, withLoginOnExternalBrowser: false })`; external login starts after the player taps the LINE button.
2. `liff.isLoggedIn()` and user-initiated `liff.login()` when needed.
3. `liff.getIDToken()`; the ID token is sent to the backend. The frontend never sends a trusted LINE user ID.
4. The backend posts `id_token` and `client_id` to LINE Login v2.1 verification and accepts the verified `sub` only after audience and expiration checks.
5. `liff.getProfile()` is optional display enrichment and is never an authentication authority.
6. `liff.isApiAvailable('shareTargetPicker')` and `liff.shareTargetPicker()` run only after a tap. Copy-link is always available.
7. `liff.scanCodeV2()` is used when available. Browser camera scanning with ZXing is the fallback; manual entry remains available.

The app now automatically exchanges a returned LINE ID token when its own app session is absent, then restores consent and squad state. Invitation intent is retained through external login. See [activation instructions](LINE_ACTIVATION.md).

Official references to revalidate before production release:

- <https://developers.line.biz/en/docs/liff/developing-liff-apps/>
- <https://developers.line.biz/en/reference/liff/>
- <https://developers.line.biz/en/docs/line-login/verify-id-token/>
- <https://developers.line.biz/en/docs/liff/developing-liff-apps/#share-target-picker>
- <https://developers.line.biz/en/reference/liff/#scan-code-v2>

This environment's network policy blocked the LINE Developers host during initial implementation, so production release must repeat this official-reference review after allowlisting is active. No deprecated or invented LIFF methods are used.

