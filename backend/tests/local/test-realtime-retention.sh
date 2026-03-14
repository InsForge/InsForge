#!/bin/bash

# Realtime message retention test script

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

# Override the shared cleanup trap so this test can restore realtime config explicitly.
trap - EXIT ERR INT TERM

echo "🧪 Testing realtime message retention..."

check_requirements

API_BASE="$TEST_API_BASE"
ADMIN_TOKEN=""
CHANNEL_NAME="retention-test-$(date +%s)"
CHANNEL_ID=""
ORIGINAL_ENABLED=""
ORIGINAL_RETENTION_DAYS=""

cleanup() {
    print_info "🧹 Cleaning up realtime retention test..."

    if [ -n "$ADMIN_TOKEN" ] && [ -n "$ORIGINAL_ENABLED" ] && [ -n "$ORIGINAL_RETENTION_DAYS" ]; then
        curl -s -X PUT "$API_BASE/realtime/messages/config" \
            -H "Authorization: Bearer $ADMIN_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"enabled\":$ORIGINAL_ENABLED,\"retentionDays\":$ORIGINAL_RETENTION_DAYS}" > /dev/null 2>&1
    fi

    if [ -n "$ADMIN_TOKEN" ]; then
        cleanup_query="DELETE FROM realtime.messages WHERE channel_name = '$CHANNEL_NAME'; DELETE FROM realtime.channels WHERE pattern = '$CHANNEL_NAME';"
        cleanup_query_escaped=${cleanup_query//\"/\\\"}
        curl -s -X POST "$API_BASE/database/advance/rawsql/unrestricted" \
            -H "Authorization: Bearer $ADMIN_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"query\":\"$cleanup_query_escaped\"}" > /dev/null 2>&1
    fi
}

trap cleanup EXIT

echo "🔑 Getting admin token..."
ADMIN_TOKEN=$(get_admin_token)

if [ -z "$ADMIN_TOKEN" ]; then
    print_fail "Failed to get admin token"
    exit 1
fi
print_success "Got admin token"
echo ""

echo "📥 Reading existing retention config..."
config_response=$(curl -s -X GET "$API_BASE/realtime/messages/config" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

ORIGINAL_ENABLED=$(echo "$config_response" | grep -o '"enabled":[^,]*' | head -1 | cut -d: -f2 | tr -d ' ')
ORIGINAL_RETENTION_DAYS=$(echo "$config_response" | grep -o '"retentionDays":[0-9]*' | head -1 | cut -d: -f2)

if [ -z "$ORIGINAL_ENABLED" ] || [ -z "$ORIGINAL_RETENTION_DAYS" ]; then
    print_fail "Failed to read original retention config"
    echo "Response: $config_response"
    exit 1
fi
print_success "Captured original retention config"
echo ""

echo "📝 Creating realtime channel..."
create_channel_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/realtime/channels" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"pattern\":\"$CHANNEL_NAME\",\"description\":\"Retention test channel\",\"enabled\":true}")

status=$(echo "$create_channel_response" | tail -n 1)
body=$(echo "$create_channel_response" | sed '$d')

if [ "$status" -eq 201 ]; then
    CHANNEL_ID=$(echo "$body" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    print_success "Realtime channel created"
else
    print_fail "Failed to create realtime channel (status: $status)"
    echo "Response: $body"
    exit 1
fi
echo ""

echo "📝 Inserting old and fresh realtime messages..."
insert_query="INSERT INTO realtime.messages (event_name, channel_id, channel_name, payload, sender_type, created_at) VALUES ('old_event_one', '$CHANNEL_ID', '$CHANNEL_NAME', '{\"kind\":\"old-1\"}'::jsonb, 'system', NOW() - INTERVAL '10 days'), ('old_event_two', '$CHANNEL_ID', '$CHANNEL_NAME', '{\"kind\":\"old-2\"}'::jsonb, 'system', NOW() - INTERVAL '8 days'), ('fresh_event', '$CHANNEL_ID', '$CHANNEL_NAME', '{\"kind\":\"fresh\"}'::jsonb, 'system', NOW() - INTERVAL '1 day');"
insert_query_escaped=${insert_query//\"/\\\"}
insert_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/database/advance/rawsql/unrestricted" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"query\":\"$insert_query_escaped\"}")

status=$(echo "$insert_response" | tail -n 1)
body=$(echo "$insert_response" | sed '$d')

if [ "$status" -eq 200 ] || [ "$status" -eq 201 ]; then
    print_success "Inserted test realtime messages"
else
    print_fail "Failed to insert test realtime messages (status: $status)"
    echo "Response: $body"
    exit 1
fi
echo ""

echo "⚙️ Updating retention to 7 days..."
update_config_response=$(curl -s -w "\n%{http_code}" -X PUT "$API_BASE/realtime/messages/config" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"enabled":true,"retentionDays":7}')

status=$(echo "$update_config_response" | tail -n 1)
body=$(echo "$update_config_response" | sed '$d')

if [ "$status" -eq 200 ] && echo "$body" | grep -q '"retentionDays":7'; then
    print_success "Retention policy updated"
else
    print_fail "Failed to update retention policy (status: $status)"
    echo "Response: $body"
    exit 1
fi
echo ""

echo "🧹 Running cleanup..."
cleanup_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/realtime/messages/cleanup" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$cleanup_response" | tail -n 1)
body=$(echo "$cleanup_response" | sed '$d')
deleted_count=$(echo "$body" | grep -o '"deletedCount":[0-9]*' | head -1 | cut -d: -f2)

if [ "$status" -eq 200 ] && [ "$deleted_count" = "2" ]; then
    print_success "Cleanup removed the expected expired rows"
else
    print_fail "Cleanup did not remove the expected rows (status: $status, deletedCount: ${deleted_count:-unknown})"
    echo "Response: $body"
fi
echo ""

echo "📊 Verifying retained message stats..."
stats_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/realtime/messages/stats?channelId=$CHANNEL_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$stats_response" | tail -n 1)
body=$(echo "$stats_response" | sed '$d')
total_messages=$(echo "$body" | grep -o '"totalMessages":[0-9]*' | head -1 | cut -d: -f2)

if [ "$status" -eq 200 ] && [ "$total_messages" = "1" ]; then
    print_success "Stats only include retained rows"
else
    print_fail "Stats did not match retained rows (status: $status, totalMessages: ${total_messages:-unknown})"
    echo "Response: $body"
fi
echo ""

echo "📋 Verifying retained message list..."
list_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/realtime/messages?channelId=$CHANNEL_ID&limit=10&offset=0" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$list_response" | tail -n 1)
body=$(echo "$list_response" | sed '$d')

if [ "$status" -eq 200 ] && echo "$body" | grep -q '"fresh_event"' && ! echo "$body" | grep -q '"old_event_one"'; then
    print_success "List endpoint only returns retained rows"
else
    print_fail "List endpoint still contains expired rows (status: $status)"
    echo "Response: $body"
fi
echo ""

if [ $TEST_FAILED -eq 1 ]; then
    exit 1
fi

print_success "🎉 Realtime retention test completed!"
