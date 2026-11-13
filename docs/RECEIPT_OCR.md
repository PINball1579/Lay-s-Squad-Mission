# Receipt Hunt / OpenThai 2.0 OCR Text

Receipt Hunt replaces the QR scan mission. Its display role is นักล่าใบเสร็จ;
the stored `qr_runner` role code is retained to preserve historical assignments,
completed squads, and analytics. The former `/api/v1/qr/validate` route returns
410 and cannot complete the new mission.

## Configuration

Set `IAPP_API_KEY` in your private `.env` file or deployment secret manager.
Never prefix the key with `VITE_`, commit it, or put it in client-side code.
Recreate the API container after changing the key:

```sh
docker compose up -d --force-recreate api web
```

Managed cloud environments that use the proxy CA must include the existing
`docker-compose.cloud.yml` override. It mounts the CA for runtime API calls as
well as supplying build trust. Keep TLS verification enabled.

The default provider endpoint is the documented
`https://api.iapp.co.th/v3/store/ocr/document/ocr`. The Go adapter uploads the
image in multipart field `file`, supplies the `apikey` header, and reads the
`text` array. `IAPP_OCR_ENDPOINT` is an operator-only override for isolated tests
or an approved compatible endpoint. HTTP redirects are rejected so the key is
not forwarded to another host. Calls may consume the account's OCR credits.

## Player journey and matching

1. Start Receipt Hunt from the squad screen.
2. Take a rear-camera photo on mobile or choose a photo from the device.
3. Review the preview and explicitly confirm sending the image to iApp.
4. Submit. A valid brand match completes the mission and updates squad progress.
5. If the image is unclear or the brand is absent, choose another photo and retry.

The app accepts JPEG and PNG images up to 10 MiB and 40 million pixels. These
limits are intentionally lower than the provider's document API limits for a
mobile, single-image mission. Convert HEIC or PDF receipts to JPEG/PNG first.

Matching accepts `LAYS`, `Lay's`, typographic apostrophes, OCR spacing such as
`LAY 'S`, and Thai `เลย์`. English matches require word boundaries, so `displays`
and `clays` do not count. Matching is performed only on the provider's response,
not on any text or success flag supplied by the browser.

This rule confirms OCR found the brand. It does not authenticate a merchant,
purchase, date, quantity, or edited receipt and does not prevent reusing the
same receipt across different squads. Those require additional campaign rules.

## Completion protection and privacy

- Authentication, CSRF, consent, assignment ownership, attempt validity, and
  campaign state are checked before spending OCR credits.
- Files are bounded, checked by their actual bytes and image dimensions, and
  never served back from the API. User-supplied filenames are not sent upstream.
- OCR has a 45-second deadline, six submissions per player per minute, and a
  maximum of four concurrent requests per API process. A multi-instance launch
  should apply the corresponding quota centrally at the edge.
- Successful OCR creates a session-bound proof, using the existing durable proof
  columns and a reserved internal `receipt-lays` source. Completion consumes only
  that source; a legacy QR proof or forged browser flag cannot complete it.
- The app does not persist the image or extracted receipt text. Only a SHA-256
  image hash, verification source, timestamps, and mission completion metadata
  are retained. The hash and raw receipt content are not sent to analytics.
- iApp receives the submitted image and processes it under its own data-handling
  terms. The UI links its documentation; campaign privacy notices must include
  this processor and the purpose of receipt processing.
- Missing keys, insufficient credits, provider failures, timeouts, invalid files,
  and no-brand results all leave the mission incomplete.

## Tests

Unit/HTTP tests inject a provider implementing the documented response contract.
They cover multipart authentication, matching and false positives, provider
failures, consent, invalid images, forged completion flags, retired QR rejection,
and idempotent completion. Component tests cover preview, consent, and retry.

For a full local test without spending live credits:

```sh
make e2e
```

For the managed cloud stack, use `make E2E_COMPOSE_ARGS='-f docker-compose.yml -f docker-compose.cloud.yml' e2e`.
The command creates image fixtures, temporarily starts the isolated provider,
clears local QA data, runs the journey, and restores the normal API afterward.
The fixture service matches exact hashes of synthetic PNG receipts and returns
documented OCR JSON; it is not an OCR model and must never be deployed for a
campaign. Restore the normal configuration after testing with
`docker compose up -d --force-recreate api web` (include the cloud overlay where
needed). To run against live OpenThai, omit the fixture overlay, keep the real
key private, and set `RECEIPT_FIXTURE_DIR` to the generated image directory before
running `npm --prefix frontend run e2e`. This makes two paid OCR requests.

Reference: <https://iapp.co.th/docs/ocr/document> (OpenThai 2.0 OCR Text, text API).
