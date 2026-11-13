#!/usr/bin/env bash
# Temporary HTTPS + real LINE login, preserving the normal local stack and data.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

for tool in docker cloudflared openssl curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing $tool. See docs/LINE_TESTING.md for installation." >&2
    exit 1
  fi
done
docker info >/dev/null 2>&1 || { echo 'Start Docker Desktop, then run this command again.' >&2; exit 1; }

mkdir -p .line-test
chmod 700 .line-test
# Serialize sessions: starting a second tunnel would invalidate the first origin.
if ! mkdir .line-test/session.lock 2>/dev/null; then
  echo 'A LINE test session is already running. Stop it with Ctrl+C first.' >&2
  echo 'If the previous terminal crashed, remove .line-test/session.lock and retry.' >&2
  exit 1
fi
tunnel_pid=''
stack_started=false
compose() {
  if [ -f .env ]; then set -- --env-file .env "$@"; fi
  docker compose --project-name crunch-squad-line-test \
    -f docker-compose.yml -f docker-compose.line-test.yml "$@"
}
cleanup() {
  trap - EXIT INT TERM
  if [ -n "$tunnel_pid" ]; then
    kill "$tunnel_pid" 2>/dev/null || true
    wait "$tunnel_pid" 2>/dev/null || true
  fi
  if [ "$stack_started" = true ]; then compose stop >/dev/null 2>&1 || true; fi
  rmdir .line-test/session.lock
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Persist only private generated test secrets, so restarting keeps the same DB.
if [ ! -f .line-test/secrets.env ]; then
  {
    for name in POSTGRES_PASSWORD QR_SIGNING_SECRET PSEUDONYM_KEY ADMIN_API_TOKEN; do
      printf '%s=%s\n' "$name" "$(openssl rand -hex 32)"
    done
  } > .line-test/secrets.env.tmp
  mv .line-test/secrets.env.tmp .line-test/secrets.env
fi
chmod 600 .line-test/secrets.env
set -a
# This file contains only the generated hex values above; never source .env.
source .line-test/secrets.env
set +a
export MOCK_LIFF=false SECURE_COOKIES=true
export POSTGRES_DB=crunch_squad POSTGRES_USER=crunch CAMPAIGN_ID=demo-campaign
export VITE_LIFF_ID="${LINE_TEST_LIFF_ID:-2012602577-R4BMg7FW}"
export LINE_CHANNEL_ID="${LINE_TEST_CHANNEL_ID:-2012602577}"
compose config --quiet # Also checks support for the !override syntax.

# Check the effective Compose value; exported variables can override .env.
# Consume the configuration privately and never print the credential.
if ! compose config --environment | awk '
  /^IAPP_API_KEY=/ {
    value = substr($0, length("IAPP_API_KEY=") + 1)
    if (value !~ /^[[:space:]]*$/) configured = 1
  }
  END { exit !configured }
'; then
  echo 'Receipt OCR is not configured: IAPP_API_KEY is missing or empty.' >&2
  echo 'Run: bash scripts/configure-ocr.sh' >&2
  echo 'An exported IAPP_API_KEY overrides .env; unset it if it is empty.' >&2
  exit 1
fi

echo 'Creating a temporary HTTPS link...'
cloudflared tunnel --url http://127.0.0.1:5174 --protocol http2 --no-autoupdate \
  > .line-test/tunnel.log 2>&1 &
tunnel_pid=$!
export ALLOWED_ORIGIN=''
for ((attempt=0; attempt<60; attempt++)); do
  # Only accept the URL inside the startup banner, never URLs in errors.
  ALLOWED_ORIGIN=$(sed -nE 's/^[^|]*\| +(https:\/\/[a-z0-9-]+\.trycloudflare\.com) +\|.*$/\1/p' .line-test/tunnel.log | head -1)
  if [ -n "$ALLOWED_ORIGIN" ]; then break; fi
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then break; fi
  sleep 1
done
if [ -z "$ALLOWED_ORIGIN" ]; then
  echo 'Could not create the tunnel. Check .line-test/tunnel.log and your network.' >&2
  exit 1
fi

echo 'Starting the separate LINE test database and rebuilding the app...'
stack_started=true
compose up --build -d --wait --wait-timeout 180

echo 'Checking the public HTTPS connection...'
public_ready=false
for ((attempt=0; attempt<30; attempt++)); do
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then break; fi
  if curl --fail --silent --max-time 5 "$ALLOWED_ORIGIN/api/v1/campaign" >/dev/null; then
    public_ready=true
    break
  fi
  sleep 1
done
if [ "$public_ready" != true ]; then
  echo 'The app started, but its public URL is unreachable. Check .line-test/tunnel.log.' >&2
  exit 1
fi

printf '\nLINE test is ready. In LINE Developers → LINE Login channel %s → LIFF → %s:\n' "$LINE_CHANNEL_ID" "$VITE_LIFF_ID"
printf 'Set Endpoint URL to: %s\n' "$ALLOWED_ORIGIN"
printf 'Enable openid and profile scopes. Save, then open on your phone:\nhttps://liff.line.me/%s\n' "$VITE_LIFF_ID"
printf '\nKeep this terminal open. Ctrl+C stops this test session and preserves its data.\n'
printf 'The HTTPS address changes each time; update the LIFF Endpoint URL after restarting.\n'
wait "$tunnel_pid"
