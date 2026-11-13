#!/usr/bin/env bash
# Keep the Official Account token server-side and out of terminal history.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

printf 'Paste the Messaging API channel access token (input is hidden): '
IFS= read -r -s messaging_token
printf '\n'
case "$messaging_token" in
  ''|*[!a-zA-Z0-9_./+=-]*)
    echo 'No changes saved. Paste the channel access token only, without spaces or quotes.' >&2
    exit 1
    ;;
esac
mkdir -p .line-test
chmod 700 .line-test
config_temp=$(mktemp .line-test/line-env.XXXXXX)
trap 'rm -f "$config_temp"' EXIT
if [ -f .env ]; then
  awk '!/^[[:space:]]*(export[[:space:]]+)?LINE_CHANNEL_ACCESS_TOKEN[[:space:]]*=/' .env > "$config_temp"
fi
printf '\nLINE_CHANNEL_ACCESS_TOKEN=%s\n' "$messaging_token" >> "$config_temp"
chmod 600 "$config_temp"
mv "$config_temp" .env
unset messaging_token
echo 'Messaging token saved privately. Restart your LINE test session to load it.'
echo 'Link the Official Account to your LINE Login channel, use the same provider, and add the account as a friend.'
