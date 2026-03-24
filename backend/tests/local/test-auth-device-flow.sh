#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

API_BASE="$TEST_API_BASE"
DEVICE_GRANT_TYPE="urn:ietf:params:oauth:grant-type:device_code"
DEFAULT_POLL_INTERVAL_SECONDS=5
DEFAULT_MAX_WAIT_SECONDS=900

read_positive_integer() {
  local value="$1"
  local fallback="$2"

  if [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "$value"
  else
    echo "$fallback"
  fi
}

if [ "${CI:-}" = "true" ] || [ ! -t 0 ]; then
  echo "Skipping manual device authorization smoke test in non-interactive mode."
  exit 0
fi

echo "🧪 Starting device authorization flow smoke test..."

create_response="$(curl -sS -X POST "$API_BASE/auth/device/authorizations" \
  -H "Content-Type: application/json" \
  -d '{}')"

device_code="$(echo "$create_response" | jq -r '.deviceCode // empty')"
user_code="$(echo "$create_response" | jq -r '.userCode // empty')"
verification_uri="$(echo "$create_response" | jq -r '.verificationUri // empty')"
verification_uri_complete="$(echo "$create_response" | jq -r '.verificationUriComplete // empty')"
poll_interval_seconds="$(read_positive_integer "$(echo "$create_response" | jq -r '.interval // empty')" "$DEFAULT_POLL_INTERVAL_SECONDS")"
expires_in_seconds="$(read_positive_integer "$(echo "$create_response" | jq -r '.expiresIn // empty')" "$DEFAULT_MAX_WAIT_SECONDS")"

if [ -z "$device_code" ] || [ -z "$user_code" ] || [ -z "$verification_uri_complete" ]; then
  echo "❌ Failed to create a device authorization session"
  echo "$create_response" | jq .
  exit 1
fi

echo "User code: $user_code"
echo "Open this URL in a browser, sign in, and confirm the device:"
echo "  $verification_uri_complete"
echo "Verification page base:"
echo "  $verification_uri"
echo
echo "Manual step: approve the device in the browser before continuing."
read -r -p "Press Enter once the browser confirmation is complete..." _

attempt=1
sleep_seconds="$poll_interval_seconds"
deadline_epoch=$(( $(date +%s) + expires_in_seconds ))

while [ "$(date +%s)" -lt "$deadline_epoch" ]; do
  echo "Polling device token endpoint (attempt $attempt)..."

  token_response="$(curl -sS -X POST "$API_BASE/auth/device/token" \
    -H "Content-Type: application/json" \
    -d "{\"deviceCode\":\"$device_code\",\"grantType\":\"$DEVICE_GRANT_TYPE\"}")"

  error="$(echo "$token_response" | jq -r '.error // empty')"

  if [ -z "$error" ]; then
    echo "Device authorization completed."
    echo "$token_response" | jq .
    exit 0
  fi

  case "$error" in
    authorization_pending)
      echo "Still pending."
      ;;
    slow_down)
      echo "Server requested slower polling."
      sleep_seconds=$((sleep_seconds + 5))
      ;;
    access_denied|expired_token|already_used)
      echo "Device authorization failed: $error"
      echo "$token_response" | jq .
      exit 1
      ;;
    *)
      echo "Unexpected response from device token endpoint:"
      echo "$token_response" | jq .
      exit 1
      ;;
  esac

  sleep "$sleep_seconds"
  attempt=$((attempt + 1))
done

echo "Timed out waiting for device authorization."
exit 1
