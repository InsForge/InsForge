#!/bin/bash

# AI Usage tracking test script

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing AI usage tracking..."

API_BASE="$TEST_API_BASE"
ADMIN_TOKEN=""

# Get admin token
echo "🔑 Getting admin token..."
ADMIN_TOKEN=$(get_admin_token)

if [ -z "$ADMIN_TOKEN" ]; then
    print_fail "Failed to get admin token"
    exit 1
fi
print_success "Got admin token"
echo ""

# 1. Get usage summary
echo "📊 Getting usage summary..."
summary_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/ai/usage/summary" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$summary_response" | tail -n 1)
body=$(echo "$summary_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Retrieved usage summary"
    echo "Response: $body" | head -c 200
    echo ""
else
    print_fail "Failed to get usage summary (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 2. Get paginated usage records
echo "📋 Getting usage records with pagination..."
usage_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/ai/usage?limit=10&offset=0" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$usage_response" | tail -n 1)
body=$(echo "$usage_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Retrieved usage records"
else
    print_fail "Failed to get usage records (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 3. Get usage with date range
echo "📅 Getting usage with date range filter..."
start_date=$(date -u +"%Y-%m-%dT%H:%M:%SZ" -d "7 days ago" 2>/dev/null || date -u -v-7d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
end_date=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

date_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/ai/usage?startDate=$start_date&endDate=$end_date&limit=10&offset=0" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$date_response" | tail -n 1)
body=$(echo "$date_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Retrieved usage with date filter"
else
    print_fail "Failed to get usage with date filter (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

print_success "🎉 AI usage tracking test completed!"
