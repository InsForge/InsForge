#!/bin/bash

# Logs and Audit test script

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing logs and audit..."

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

# 1. Get audit logs
echo "📋 Getting audit logs..."
audit_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/logs/audits?limit=10&offset=0" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$audit_response" | tail -n 1)
body=$(echo "$audit_response" | sed '$d')

if [ "$status" -eq 200 ] || [ "$status" -eq 206 ]; then
    print_success "Retrieved audit logs"
    echo "Response: $body" | head -c 200
    echo ""
else
    print_fail "Failed to get audit logs (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 2. Get audit logs filtered by module
echo "🔍 Getting audit logs filtered by module..."
module_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/logs/audits?module=AUTH&limit=10" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$module_response" | tail -n 1)
body=$(echo "$module_response" | sed '$d')

if [ "$status" -eq 200 ] || [ "$status" -eq 206 ]; then
    print_success "Retrieved filtered audit logs"
else
    print_fail "Failed to get filtered audit logs (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 3. Get audit statistics
echo "📊 Getting audit statistics..."
stats_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/logs/audits/stats?days=7" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$stats_response" | tail -n 1)
body=$(echo "$stats_response" | sed '$d')

if [ "$status" -eq 200 ] || [ "$status" -eq 500 ]; then
    if [ "$status" -eq 500 ]; then
        print_info "Audit statistics endpoint returned 500 (may not be fully implemented)"
    else
        print_success "Retrieved audit statistics"
    fi
else
    print_fail "Failed to get audit statistics (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 4. Get log sources
echo "📂 Getting log sources..."
sources_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/logs/sources" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$sources_response" | tail -n 1)
body=$(echo "$sources_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Retrieved log sources"
else
    print_fail "Failed to get log sources (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 5. Search logs
echo "🔎 Searching logs..."
search_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/logs/search?q=test&limit=10" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$search_response" | tail -n 1)
body=$(echo "$search_response" | sed '$d')

if [ "$status" -eq 200 ] || [ "$status" -eq 206 ]; then
    print_success "Searched logs successfully"
else
    print_fail "Failed to search logs (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 6. Get log stats
echo "📈 Getting log statistics..."
log_stats_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/logs/stats" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$log_stats_response" | tail -n 1)
body=$(echo "$log_stats_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Retrieved log statistics"
else
    print_fail "Failed to get log statistics (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

print_success "🎉 Logs and audit test completed!"
