#!/usr/bin/env bash
# Save the local OCR credential without echoing it or putting it in shell history.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

printf 'Paste your iApp API key (input is hidden): '
IFS= read -r -s iapp_key
printf '\n'
case "$iapp_key" in
  ''|*[!a-zA-Z0-9_-]*)
    echo 'No changes saved. Enter the API key only, without spaces or quotes.' >&2
    exit 1
    ;;
esac

mkdir -p .line-test
chmod 700 .line-test
config_temp=$(mktemp .line-test/ocr-env.XXXXXX)
trap 'rm -f "$config_temp"' EXIT
if [ -f .env ]; then
  awk '!/^[[:space:]]*(export[[:space:]]+)?IAPP_API_KEY[[:space:]]*=/' .env > "$config_temp"
fi
printf '\nIAPP_API_KEY=%s\n' "$iapp_key" >> "$config_temp"
chmod 600 "$config_temp"
mv "$config_temp" .env
unset iapp_key
echo 'Saved privately in .env. Existing database and other settings are preserved.'
echo 'Restart your running test session or recreate its API container to load the key.'
