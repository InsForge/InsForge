#!/bin/bash

# End-to-end rate-limit configuration verification.
# Flow:
# 1. Update persisted rate-limit config via PUT /api/auth/rate-limits
# 2. Hit OTP send endpoint twice from same client IP with different emails
# 3. Confirm second request is blocked by configured per-IP limiter
# 4. Restore original config values

set -uo pipefail

API_BASE="${TEST_API_BASE:-http://localhost:7130/api}"
ADMIN_EMAIL="${TEST_ADMIN_EMAIL:-${ADMIN_EMAIL:-admin@example.com}}"
ADMIN_PASSWORD="${TEST_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-change-this-password}}"
TEST_CLIENT_IP="${RATE_LIMIT_TEST_IP:-198.51.100.77}"

TEST_FAILED=0
DID_UPDATE=0
ADMIN_TOKEN=""
ORIGINAL_SEND_MAX=""
ORIGINAL_SEND_WINDOW=""

print_success() {
  echo "[PASS] $1"
}

print_fail() {
  echo "[FAIL] $1"
  TEST_FAILED=1
}

print_info() {
  echo "[INFO] $1"
}

extract_body() {
  echo "$1" | sed '$d'
}

extract_status() {
  echo "$1" | tail -n 1
}

restore_original_config() {
  if [ "$DID_UPDATE" -ne 1 ]; then
    return
  fi

  if [ -z "$ADMIN_TOKEN" ] || [ -z "$ORIGINAL_SEND_MAX" ] || [ -z "$ORIGINAL_SEND_WINDOW" ]; then
    print_fail "Cannot restore rate-limit config because original values are missing"
    return
  fi

  local payload
  payload=$(jq -n \
    --argjson max "$ORIGINAL_SEND_MAX" \
    --argjson window "$ORIGINAL_SEND_WINDOW" \
    '{sendEmailOtpMaxRequests: $max, sendEmailOtpWindowMinutes: $window}')

  local restore_response
  restore_response=$(curl -s -w "\n%{http_code}" -X PUT "$API_BASE/auth/rate-limits" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload")

  local restore_status
  restore_status=$(extract_status "$restore_response")

  if [ "$restore_status" -ge 200 ] && [ "$restore_status" -lt 300 ]; then
    print_success "Restored original rate-limit config"
  else
    print_fail "Failed to restore original rate-limit config (HTTP $restore_status)"
    echo "$(extract_body "$restore_response")"
  fi
}

print_info "Testing persisted rate-limit config -> middleware enforcement flow"
print_info "API base: $API_BASE"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this test"
  exit 1
fi

# 1) Admin login
login_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/auth/admin/sessions" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
login_body=$(extract_body "$login_response")
login_status=$(extract_status "$login_response")

if [ "$login_status" -lt 200 ] || [ "$login_status" -ge 300 ]; then
  print_fail "Admin login failed (HTTP $login_status)"
  echo "$login_body"
  exit 1
fi

ADMIN_TOKEN=$(echo "$login_body" | jq -r '.data.accessToken // .accessToken // empty')
if [ -z "$ADMIN_TOKEN" ]; then
  print_fail "Admin login succeeded but access token is missing"
  echo "$login_body"
  exit 1
fi
print_success "Acquired admin token"

# 2) Fetch existing config (for restore)
get_config_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/auth/rate-limits" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json")
get_config_body=$(extract_body "$get_config_response")
get_config_status=$(extract_status "$get_config_response")

if [ "$get_config_status" -lt 200 ] || [ "$get_config_status" -ge 300 ]; then
  print_fail "Failed to fetch current rate-limit config (HTTP $get_config_status)"
  echo "$get_config_body"
  exit 1
fi

ORIGINAL_SEND_MAX=$(echo "$get_config_body" | jq -r '.data.sendEmailOtpMaxRequests // empty')
ORIGINAL_SEND_WINDOW=$(echo "$get_config_body" | jq -r '.data.sendEmailOtpWindowMinutes // empty')

if [ -z "$ORIGINAL_SEND_MAX" ] || [ -z "$ORIGINAL_SEND_WINDOW" ]; then
  print_fail "Current config response missing expected fields"
  echo "$get_config_body"
  exit 1
fi

print_info "Original sendEmailOtpMaxRequests=$ORIGINAL_SEND_MAX, sendEmailOtpWindowMinutes=$ORIGINAL_SEND_WINDOW"

# 3) Update config to strict per-IP limit for test
update_payload='{"sendEmailOtpMaxRequests":1,"sendEmailOtpWindowMinutes":1}'
update_response=$(curl -s -w "\n%{http_code}" -X PUT "$API_BASE/auth/rate-limits" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$update_payload")
update_body=$(extract_body "$update_response")
update_status=$(extract_status "$update_response")

if [ "$update_status" -lt 200 ] || [ "$update_status" -ge 300 ]; then
  print_fail "Failed to update rate-limit config (HTTP $update_status)"
  echo "$update_body"
  exit 1
fi

DID_UPDATE=1
print_success "Updated rate-limit config for test"

# 4) Verify middleware enforcement on OTP send endpoint
# Use two different emails to avoid per-email cooldown affecting assertion.
EMAIL_ONE="ratelimit.one.$(date +%s)@example.com"
EMAIL_TWO="ratelimit.two.$(date +%s)@example.com"

first_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/auth/email/send-verification" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: $TEST_CLIENT_IP, 10.0.0.1" \
  -d "{\"email\":\"$EMAIL_ONE\"}")
first_body=$(extract_body "$first_response")
first_status=$(extract_status "$first_response")

if [ "$first_status" -eq 202 ] || [ "$first_status" -eq 200 ]; then
  print_success "First send-verification request allowed (HTTP $first_status)"
else
  print_fail "First send-verification request failed unexpectedly (HTTP $first_status)"
  echo "$first_body"
fi

second_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/auth/email/send-verification" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: $TEST_CLIENT_IP, 10.0.0.1" \
  -d "{\"email\":\"$EMAIL_TWO\"}")
second_body=$(extract_body "$second_response")
second_status=$(extract_status "$second_response")

if [ "$second_status" -eq 429 ]; then
  print_success "Second send-verification request correctly blocked (HTTP 429)"
else
  print_fail "Expected second request to be rate-limited, got HTTP $second_status"
  echo "$second_body"
fi

# 5) Always restore config before exit
restore_original_config

if [ "$TEST_FAILED" -eq 1 ]; then
  exit 1
fi

print_success "Rate-limit config end-to-end flow passed"
exit 0
