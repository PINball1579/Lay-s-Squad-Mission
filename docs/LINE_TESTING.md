# Test LINE login without a domain

A Cloudflare Quick Tunnel supplies a temporary public HTTPS address. It enables
LINE login and phone camera access without buying a domain. Run this on the Mac
with the repository and Docker Desktop. The managed cloud environment currently
refuses the tunnel's direct network connection.

## Start a session on macOS

1. Start Docker Desktop. Install the tunnel tool once with Homebrew:

   ```sh
   brew install cloudflared
   ```

2. Update your checkout and start the test session:

   ```sh
   cd "$HOME/Documents/Liff_Idea/Lay-s-Squad-Mission"
   git pull --ff-only
   bash scripts/configure-ocr.sh
   bash scripts/configure-line-messaging.sh
   bash scripts/test-line.sh
   ```

   Docker Compose 2.24.4 or newer is required; update Docker Desktop if it
   rejects `!override`. This starts a separate Compose project on port 5174
   with real LINE login and its own database. Your usual local stack and data
   are preserved. Generated secrets stay in ignored `.line-test/` files.
   The configuration command asks for your iApp key with hidden input and saves
   it to private `.env`, preserving other settings. Run it once, or again when
   changing the key. Startup checks that `IAPP_API_KEY` is configured before
   creating the tunnel. This checks presence, not provider validity or credits.
   Configure the Messaging API token once for completion cards; see
   [LINE cards and account settings](LINE_MESSAGES.md).
   Do not put API keys into the LIFF endpoint or browser URL.

3. Wait for **LINE test is ready**. Copy the displayed **Endpoint URL**.
   In <https://developers.line.biz/console/>, open your LINE Login channel
   **2012602577**, its **LIFF** tab, and app **2012602577-R4BMg7FW**. Edit the
   Endpoint URL, replace `https://test.com` with the tunnel URL, and save.
   Select Full view, enable `openid` and `profile`, and enable Share target
   picker for invitations. Use the LINE Login channel, not Messaging API.

4. Open <https://liff.line.me/2012602577-R4BMg7FW> on your phone. Keep the
   terminal and Mac running. While the channel is in Developing status, add
   every tester's LINE account to the channel's Roles; each must accept the
   invitation. A browser in incognito mode using the same LINE account is
   still the same player. Squad testing needs distinct LINE accounts.

## Check the complete flow

- Sign in with LINE, accept consent, create a squad, and lock a mission.
- Add the linked Official Account as a friend to receive completion cards.
- Invite a second LINE account using the friend picker. Confirm a Flex card
  arrives in their chat. Check that the link
  survives login and takes the joiner straight to the squad's available roles.
- With four different accounts, complete all four missions. For Receipt Hunt,
  allow camera access, photograph a receipt containing Lay's, and verify it.
  A receipt without Lay's should not complete the mission. Live OCR calls use
  your iApp credits.
- After each mission, check the Thai congratulations card in the Official
  Account chat. Cancelling an invitation must not report that it was sent.
- After all missions finish, claim the reward and verify that its coupon popup
  reopens after refresh. Seeded `MOCK-` coupon codes are for testing and cannot
  be used in shops; actual issuer inventory is needed for launch.

Press Ctrl+C to stop the test stack and tunnel. The test database is retained.
The next session gets a new HTTPS address: update the LIFF Endpoint URL again.
New invitation cards use the stable LIFF URL and follow its updated endpoint.
Older links copied directly from a tunnel address stop working with that tunnel.

For another LINE app, set `LINE_TEST_LIFF_ID` and `LINE_TEST_CHANNEL_ID` when
running the script. No LINE channel secret or Messaging API access token is
needed for this application's ID-token verification flow.

## Receipt OCR says it is not connected

The Thai message `ระบบอ่านใบเสร็จยังไม่ได้เชื่อมต่อ` means the API container
started without `IAPP_API_KEY`. A key configured in the managed cloud is not
automatically available on your Mac, and private `.env` files are not in Git.

Stop the running `test-line.sh` session with Ctrl+C, then run
`bash scripts/configure-ocr.sh` and `bash scripts/test-line.sh`. Update the LIFF
Endpoint URL to the newly printed tunnel URL and reopen the app. Do not reset
the database. Never share your key or full Compose configuration in chat.
