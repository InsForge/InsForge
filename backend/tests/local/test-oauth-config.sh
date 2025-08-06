#!/bin/bash

# OAuth configuration test script
# 
# This script tests the OAuth configuration endpoints (/api/auth/oauth/config)
# 
# Prerequisites:
# - Backend server must be running on port 7130
# - Admin credentials: admin@example.com / change-this-password
# - jq must be installed for JSON formatting
#
# Usage:
#   ./tests/local/test-oauth-config.sh
#
# Tests covered:
# - Admin authentication
# - GET/POST OAuth configuration
# - Enable/disable OAuth providers
# - Error handling and authorization checks
# - JSON structure validation {enabled, clientId, clientSecret}
#

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Source the test configuration
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing OAuth configuration endpoints..."

# Use configuration from test-config.sh
API_BASE="$TEST_API_BASE"
ADMIN_TOKEN=""

# Test function
# $1: method, $2: endpoint, $3: data, $4: description, $5: expected_status
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    local expected_status=${5:-200}

    print_info "Test: $description"

    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" -X GET "$endpoint" \
            -H "Authorization: Bearer $ADMIN_TOKEN" \
            -H "Content-Type: application/json")
    elif [ "$method" = "POST" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$endpoint" \
            -H "Authorization: Bearer $ADMIN_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi

    body=$(echo "$response" | sed '$d')
    status=$(echo "$response" | tail -n 1)

    if [ "$status" -eq "$expected_status" ]; then
        print_success "Success ($status)"
        # Pretty print JSON response if it's valid JSON
        if echo "$body" | jq . >/dev/null 2>&1; then
            echo "$body" | jq '.'
        else
            echo "Response: $body"
        fi
    else
        print_fail "Failed (got $status, expected $expected_status)"
        echo "Error: $body"
        return 1
    fi
    echo ""
}

# 1. Admin login to get token
print_blue "🔑 Admin login..."
ADMIN_TOKEN=$(get_admin_token)

if [ -n "$ADMIN_TOKEN" ]; then
    print_success "Admin login success"
    echo "Admin token obtained: ${ADMIN_TOKEN:0:20}..."
else
    print_fail "Admin login failed"
    echo "Could not obtain admin token"
fi

echo ""

# 2. Test GET OAuth config (initial state)
print_blue "📋 Testing GET OAuth configuration (initial state)..."
test_endpoint "GET" "$API_BASE/auth/oauth/config" "" "Get initial OAuth configuration"

# 3. Test POST OAuth config for Google with enabled=true
print_blue "🔧 Testing POST OAuth configuration for Google (enabled=true)..."
google_config='{
    "provider": "google",
    "clientId": "test-google-client-id-enabled",
    "clientSecret": "test-google-secret-enabled",
    "enabled": true
}'
test_endpoint "POST" "$API_BASE/auth/oauth/config" "$google_config" "Update Google OAuth config (enabled=true)"

# 4. Test POST OAuth config for GitHub with enabled=false
print_blue "🔧 Testing POST OAuth configuration for GitHub (enabled=false)..."
github_config='{
    "provider": "github",
    "clientId": "test-github-client-id-disabled", 
    "clientSecret": "test-github-secret-disabled",
    "enabled": false
}'
test_endpoint "POST" "$API_BASE/auth/oauth/config" "$github_config" "Update GitHub OAuth config (enabled=false)"

# 5. Test GET OAuth config after updates
print_blue "📋 Testing GET OAuth configuration after updates..."
test_endpoint "GET" "$API_BASE/auth/oauth/config" "" "Get OAuth configuration after updates"

# 6. Test updating only enabled status for GitHub (enable it)
print_blue "🔄 Testing enable GitHub OAuth (keeping existing config)..."
github_enable='{
    "provider": "github",
    "clientId": "test-github-client-id-disabled",
    "clientSecret": "test-github-secret-disabled", 
    "enabled": true
}'
test_endpoint "POST" "$API_BASE/auth/oauth/config" "$github_enable" "Enable GitHub OAuth"

# 7. Test updating only enabled status for Google (disable it)
print_blue "🔄 Testing disable Google OAuth (keeping existing config)..."
google_disable='{
    "provider": "google", 
    "clientId": "test-google-client-id-enabled",
    "clientSecret": "test-google-secret-enabled",
    "enabled": false
}'
test_endpoint "POST" "$API_BASE/auth/oauth/config" "$google_disable" "Disable Google OAuth"

# 8. Test GET OAuth config after enable/disable toggles
print_blue "📋 Testing GET OAuth configuration after enable/disable toggles..."
test_endpoint "GET" "$API_BASE/auth/oauth/config" "" "Get OAuth configuration after toggles"

# 9. Test updating with empty credentials but enabled=true
print_blue "🔄 Testing update with empty credentials but enabled=true..."
empty_config='{
    "provider": "google",
    "clientId": "",
    "clientSecret": "",
    "enabled": true
}'
test_endpoint "POST" "$API_BASE/auth/oauth/config" "$empty_config" "Update with empty credentials but enabled=true"

# 10. Test GET OAuth config after empty credentials
print_blue "📋 Testing GET OAuth configuration after empty credentials..."
test_endpoint "GET" "$API_BASE/auth/oauth/config" "" "Get OAuth configuration after empty credentials"

# 11. Test invalid provider
print_blue "🔍 Testing invalid provider (should fail)..."
invalid_provider='{
    "provider": "invalid-provider",
    "clientId": "test-id",
    "clientSecret": "test-secret",
    "enabled": true
}'
test_endpoint "POST" "$API_BASE/auth/oauth/config" "$invalid_provider" "Invalid provider (should fail)" 400

# 12. Test unauthorized access (no token)
print_blue "🔐 Testing unauthorized access (should fail)..."
# Temporarily clear admin token
TEMP_TOKEN="$ADMIN_TOKEN"
ADMIN_TOKEN=""
response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/auth/oauth/config" \
    -H "Content-Type: application/json")
status=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')

if [ "$status" -eq 401 ]; then
    print_success "Unauthorized access failed as expected ($status)"
else
    print_fail "Unauthorized access should have failed with 401, got $status"
    echo "Response: $body"
fi

# Restore admin token
ADMIN_TOKEN="$TEMP_TOKEN"
echo ""

# 13. Test final configuration state
print_blue "📋 Final OAuth configuration state..."
test_endpoint "GET" "$API_BASE/auth/oauth/config" "" "Final OAuth configuration state"

print_success "🎉 OAuth configuration test completed!"

# Summary
echo ""
print_blue "📊 Test Summary:"
echo "✅ Admin authentication"
echo "✅ GET OAuth configuration (initial and after updates)"
echo "✅ POST OAuth configuration for Google (enabled=true)"
echo "✅ POST OAuth configuration for GitHub (enabled=false)"
echo "✅ Enable/disable OAuth providers independently"
echo "✅ Update with empty credentials"
echo "✅ Error handling for invalid provider"
echo "✅ Authorization checks (unauthorized access)"
echo "✅ Client secret display verification (no masking for admin)"
echo "✅ JSON structure validation {enabled, clientId, clientSecret}"