# LINE invitation and completion cards

## What the player sees

- **ชวนเพื่อนเข้าทีม** opens LINE's friend/group picker. Confirming recipients
  sends a Thai Flex invitation into their chats. The card's **เข้าร่วมทีม**
  button uses the LIFF URL with the squad invitation token, preserving the
  invitation through LINE login. The invitation is prepared before the tap so
  an HTTP request does not interrupt the user gesture needed by the picker.
- Cancelling the picker does not show success or record a completed share.
  If sharing is unavailable, the player sees guidance to open the app in LINE;
  it never silently copies the invitation. An explicit link-copy button exists
  only in local mock mode for QA.
- Completing a mission saves it first, then requests a congratulations Flex
  card from the campaign's LINE Official Account to that player. It names the
  mission and squad, shows team progress, and encourages friends to complete
  their other missions. The fourth completion instead points to the reward.
- A delivery failure leaves the mission saved and offers a retry on the squad
  screen. Messaging acceptance does not guarantee delivery: LINE can accept a
  request without delivering it if the account is blocked or not a friend.

## Account settings required once

1. LINE Login channel **2012602577** and Messaging API channel **2012602675**
   must be under the **same provider**, so their LINE user IDs refer to the same
   people. Use the Official Account belonging to the Messaging API channel.
2. In the LINE Login channel's Basic settings, link that Official Account.
   Configure the LIFF add-friend option to show it during login. Players should
   add the Official Account as a friend and leave it unblocked.
3. Open LIFF app **2012602577-R4BMg7FW**, enable **Share target picker**, and
   retain `openid` and `profile` scopes. No `chat_message.write` scope is needed
   for these server-side completion notifications. The share picker can also
   work in supported external browsers; opening in LINE is the easiest test.
4. Obtain a valid channel access token from **Messaging API** channel settings.
   On your Mac, run:

   ```sh
   bash scripts/configure-line-messaging.sh
   ```

   Paste the token into the hidden prompt. It saves `LINE_CHANNEL_ACCESS_TOKEN`
   in private `.env`, preserving OCR and other settings. This is not a channel
   secret or LINE Login ID token. Never prefix it with `VITE_` or commit it.
5. Stop and restart `bash scripts/test-line.sh`. It checks both OCR and
   Messaging API credentials are present before creating a tunnel. Update the
   LIFF endpoint to the new HTTPS URL as usual. Existing data is preserved and
   migration 0014 applies automatically.

## Delivery and identity checks

The browser supplies its LINE ID token alongside mission completion. The server
verifies it directly with LINE, derives the same pseudonymous identity used at
login, and compares it to the authenticated player. It never accepts a recipient
ID from the browser. The token is not stored in completion properties, logs,
analytics, or local storage. Mock mode never calls the messaging provider.

Each completion has a deterministic UUID sent as `X-Line-Retry-Key`. A duplicate
request accepted by LINE is recognized only when its 409 response includes
`X-Line-Accepted-Request-Id`. PostgreSQL records accepted completion IDs, so
subsequent replays and API restarts do not resend accepted cards. No raw LINE
user IDs or message bodies are stored. The original squad name, completion count,
and reward state are frozen before sending so retries keep the same card details
even if teammates finish later. Failed delivery is retried only when the
player taps retry; there is no background broadcast or automatic friend reminder.
LINE's retry-key retention is limited, so an ambiguous request whose acceptance
could not be recorded should be retried promptly. Normal Messaging API quotas
and plan limits apply.

## Verify on phones

1. Add the Official Account as a friend, then open the LIFF app and create a
   squad. Tap **ชวนเพื่อนเข้าทีม**, select a different LINE account, and send.
   Confirm a Flex card appears in that chat and its button joins the right team.
2. Cancel another share and confirm there is no success message.
3. Complete a mission and check the Official Account chat for the Thai card.
   Return to the squad through its button. Complete the remaining missions on
   distinct accounts and check the final player's card points to the reward.
4. In a separate test configuration, use an invalid Messaging API token to
   confirm mission progress stays complete and retry is offered. Restore a valid
   token and restart before further testing. Do not post tokens or full Compose
   configuration in bug reports.

Official references:

- <https://developers.line.biz/en/reference/liff/#share-target-picker>
- <https://developers.line.biz/en/reference/messaging-api/#send-push-message>
- <https://developers.line.biz/en/docs/messaging-api/retrying-api-request/>
- <https://developers.line.biz/en/docs/line-login/link-a-bot/>
