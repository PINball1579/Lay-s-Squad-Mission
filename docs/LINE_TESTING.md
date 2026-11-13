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
   bash scripts/test-line.sh
   ```

   Docker Compose 2.24.4 or newer is required; update Docker Desktop if it
   rejects `!override`. This starts a separate Compose project on port 5174
   with real LINE login and its own database. Your usual local stack and data
   are preserved. Generated secrets stay in ignored `.line-test/` files.
   Receipt OCR uses `IAPP_API_KEY` from your existing private `.env`, if set.
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
- Invite a second LINE account using the invite button. Check that the link
  survives login and takes the joiner straight to the squad's available roles.
- With four different accounts, complete all four missions. For Receipt Hunt,
  allow camera access, photograph a receipt containing Lay's, and verify it.
  A receipt without Lay's should not complete the mission. Live OCR calls use
  your iApp credits.
- After all missions finish, claim the reward and verify that its coupon popup
  reopens after refresh. Seeded `MOCK-` coupon codes are for testing and cannot
  be used in shops; actual issuer inventory is needed for launch.

Press Ctrl+C to stop the test stack and tunnel. The test database is retained.
The next session gets a new HTTPS address: update the LIFF Endpoint URL again.
Old invitation URLs use the previous address; create new invitations.

For another LINE app, set `LINE_TEST_LIFF_ID` and `LINE_TEST_CHANNEL_ID` when
running the script. No LINE channel secret or Messaging API access token is
needed for this application's ID-token verification flow.
