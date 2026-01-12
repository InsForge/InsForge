#!/bin/bash

# RPC endpoint test script

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Source the test configuration
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing RPC endpoint..."

# Configuration
API_BASE="$TEST_API_BASE"
AUTH_TOKEN=""
TEST_FUNC="test_rpc_add_$(date +%s)"

# 1. Login to get token
echo "🔑 Logging in to get authentication token..."
AUTH_TOKEN=$(get_admin_token)

if [ -n "$AUTH_TOKEN" ]; then
    print_success "Login successful"
else
    print_fail "Login failed"
    echo "Please ensure the service is running and admin account exists"
    exit 1
fi

# 2. Create test PostgreSQL function
echo ""
print_info "📝 Creating test RPC function ($TEST_FUNC)..."

create_func_response=$(curl -s -X POST "$API_BASE/database/advance/rawsql/unrestricted" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"query": "CREATE OR REPLACE FUNCTION '"$TEST_FUNC"'(a integer, b integer) RETURNS integer LANGUAGE sql AS $$ SELECT a + b; $$;"}')

if echo "$create_func_response" | grep -q '"error"'; then
    print_fail "Failed to create test function"
    echo "Response: $create_func_response"
    exit 1
else
    print_success "Test function created"
fi

# Wait for PostgREST schema cache to refresh
echo "⏳ Waiting for schema cache refresh..."
sleep 3

# 3. Test RPC POST with JSON body
echo ""
print_info "🔧 Test 1: RPC POST with JSON body"

rpc_post_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/database/rpc/$TEST_FUNC" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"a": 5, "b": 3}')

body=$(echo "$rpc_post_response" | sed '$d')
status=$(echo "$rpc_post_response" | tail -n 1)

if [ "$status" -eq 200 ] && [ "$body" = "8" ]; then
    print_success "RPC POST: 5 + 3 = $body"
else
    print_fail "RPC POST failed (status: $status)"
    echo "Expected: 8, Got: $body"
fi

# 4. Test RPC GET with query params
echo ""
print_info "🔧 Test 2: RPC GET with query params"

rpc_get_response=$(curl -s -w "\n%{http_code}" "$API_BASE/database/rpc/$TEST_FUNC?a=10&b=20" \
    -H "Authorization: Bearer $AUTH_TOKEN")

body=$(echo "$rpc_get_response" | sed '$d')
status=$(echo "$rpc_get_response" | tail -n 1)

if [ "$status" -eq 200 ] && [ "$body" = "30" ]; then
    print_success "RPC GET: 10 + 20 = $body"
else
    print_fail "RPC GET failed (status: $status)"
    echo "Expected: 30, Got: $body"
fi

# 5. Test RPC with non-existent function (should return 404)
echo ""
print_info "🔧 Test 3: RPC call to non-existent function (expect 404)"

rpc_404_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/database/rpc/nonexistent_function_xyz" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}')

body=$(echo "$rpc_404_response" | sed '$d')
status=$(echo "$rpc_404_response" | tail -n 1)

if [ "$status" -eq 404 ]; then
    print_success "Non-existent function returns 404"
else
    print_fail "Expected 404, got $status"
    echo "Response: $body"
fi

# 6. Test RPC with wrong parameter types
echo ""
print_info "🔧 Test 4: RPC with wrong parameter types (expect error)"

rpc_error_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/database/rpc/$TEST_FUNC" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"a": "not_a_number", "b": 3}')

body=$(echo "$rpc_error_response" | sed '$d')
status=$(echo "$rpc_error_response" | tail -n 1)

if [ "$status" -ge 400 ]; then
    print_success "Invalid params return error ($status)"
else
    print_fail "Expected error status, got $status"
    echo "Response: $body"
fi

# 7. Cleanup - drop the test function
echo ""
print_info "🧹 Cleaning up test function..."

cleanup_response=$(curl -s -X POST "$API_BASE/database/advance/rawsql/unrestricted" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"query": "DROP FUNCTION IF EXISTS '"$TEST_FUNC"'(integer, integer);"}')

if echo "$cleanup_response" | grep -q '"error"'; then
    print_fail "Cleanup failed"
else
    print_success "Test function dropped"
fi

echo ""
echo -e "${GREEN}🎉 RPC endpoint tests completed!${NC}"
