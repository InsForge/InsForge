#!/bin/bash

# End-to-end test for the schedules router.
#
# Covers the sub-minute cadence support added in InsForge#1159:
#   - POST /api/schedules accepts pg_cron interval syntax ("30 seconds")
#   - POST /api/schedules accepts the existing 5-field cron format
#   - POST /api/schedules rejects malformed values ("2 days", "2.5 seconds")
#   - GET /api/schedules/:id/logs surfaces fires from a sub-minute job
#
# Requires:
#   - Backend reachable at $TEST_API_BASE (default http://localhost:7130/api)
#   - Admin credentials per test-config.sh
#   - A reachable echo server. By default we use http://example.com (returns 200);
#     set ECHO_URL to override.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

API_BASE="$TEST_API_BASE"
ECHO_URL="${ECHO_URL:-http://example.com}"

declare -a SCHEDULES_CREATED=()

cleanup_schedules() {
    local token=$1
    if [ ${#SCHEDULES_CREATED[@]} -gt 0 ] && [ -n "$token" ]; then
        for sid in "${SCHEDULES_CREATED[@]}"; do
            curl -s -X DELETE "$API_BASE/schedules/$sid" \
                -H "Authorization: Bearer $token" >/dev/null 2>&1
        done
    fi
}

echo "Testing schedules router (sub-minute cadence)..."
check_requirements

ADMIN_TOKEN=$(get_admin_token)
if [ -z "$ADMIN_TOKEN" ]; then
    print_fail "Could not log in as admin — is the backend running at $API_BASE?"
    exit 1
fi
print_success "Admin token acquired"

# 1) accept "30 seconds"
print_info "1) POST /schedules with cronSchedule=\"30 seconds\""
resp=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/schedules" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "{\"name\":\"e2e-30s-$$\",\"cronSchedule\":\"30 seconds\",\"functionUrl\":\"$ECHO_URL\",\"httpMethod\":\"POST\"}")
status=$(echo "$resp" | tail -n1); body=$(echo "$resp" | sed '$d')
if [ "$status" = "200" ] || [ "$status" = "201" ]; then
    print_success "  Accepted (status $status)"
    sid=$(echo "$body" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
    [ -n "$sid" ] && SCHEDULES_CREATED+=("$sid")
else
    print_fail "  Expected 200/201, got $status: $body"
fi

# 2) accept "*/5 * * * *"
print_info "2) POST /schedules with cronSchedule=\"*/5 * * * *\""
resp=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/schedules" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "{\"name\":\"e2e-5min-$$\",\"cronSchedule\":\"*/5 * * * *\",\"functionUrl\":\"$ECHO_URL\",\"httpMethod\":\"POST\"}")
status=$(echo "$resp" | tail -n1); body=$(echo "$resp" | sed '$d')
if [ "$status" = "200" ] || [ "$status" = "201" ]; then
    print_success "  Accepted (status $status)"
    sid=$(echo "$body" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
    [ -n "$sid" ] && SCHEDULES_CREATED+=("$sid")
else
    print_fail "  Expected 200/201, got $status: $body"
fi

# 3) reject "2 days"
print_info "3) POST /schedules with cronSchedule=\"2 days\" (should reject)"
resp=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/schedules" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "{\"name\":\"e2e-bad1-$$\",\"cronSchedule\":\"2 days\",\"functionUrl\":\"$ECHO_URL\",\"httpMethod\":\"POST\"}")
status=$(echo "$resp" | tail -n1); body=$(echo "$resp" | sed '$d')
if [ "$status" = "400" ]; then
    if echo "$body" | grep -q "interval form\|seconds"; then
        print_success "  Rejected with helpful error message"
    else
        print_fail "  Got 400 but error message doesn't mention interval/seconds: $body"
    fi
else
    print_fail "  Expected 400, got $status: $body"
fi

# 4) reject "2.5 seconds"
print_info "4) POST /schedules with cronSchedule=\"2.5 seconds\" (should reject)"
resp=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/schedules" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "{\"name\":\"e2e-bad2-$$\",\"cronSchedule\":\"2.5 seconds\",\"functionUrl\":\"$ECHO_URL\",\"httpMethod\":\"POST\"}")
status=$(echo "$resp" | tail -n1)
if [ "$status" = "400" ]; then
    print_success "  Rejected (status 400)"
else
    print_fail "  Expected 400, got $status"
fi

# 5) sub-minute fire — only run if SCHEDULES_WAIT_FOR_FIRE=1 (off by default to keep tests fast)
if [ "$SCHEDULES_WAIT_FOR_FIRE" = "1" ] && [ ${#SCHEDULES_CREATED[@]} -gt 0 ]; then
    sid="${SCHEDULES_CREATED[0]}"
    print_info "5) Polling /schedules/$sid/logs for ≥1 fire (≤75s)"
    fired=0
    for i in 1 2 3 4 5; do
        sleep 15
        count=$(curl -s "$API_BASE/schedules/$sid/logs?limit=10" \
            -H "Authorization: Bearer $ADMIN_TOKEN" \
            | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('totalCount',0))" 2>/dev/null || echo 0)
        if [ "$count" -ge 1 ]; then
            print_success "  Schedule fired ($count log row(s) after $((i*15))s)"
            fired=1
            break
        fi
    done
    [ $fired -eq 0 ] && print_fail "  No fires observed in 75s — pg_cron may not be running"
else
    print_info "5) Skipping fire-poll (set SCHEDULES_WAIT_FOR_FIRE=1 to enable)"
fi

cleanup_schedules "$ADMIN_TOKEN"

if [ $TEST_FAILED -eq 1 ]; then
    print_fail "Schedules tests FAILED"
    exit 1
else
    print_success "Schedules tests passed"
    exit 0
fi
