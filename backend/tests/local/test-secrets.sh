#!/bin/bash

# Test secrets API endpoints (refactored to use _secrets table)
# Tests CRUD operations for secrets and edge function integration

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

# API base URL
API_BASE="${TEST_API_BASE:-http://localhost:7130/api}"
DENO_BASE="${DENO_BASE:-http://localhost:7133}"

print_blue "🔐 Testing Secrets API (refactored)..."

# 1. Test authentication requirement
print_info "1. Testing authentication requirement for secrets"
response=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/secrets")
if [ "$response" = "401" ]; then
    print_success "Unauthorized without auth"
else
    print_fail "Expected 401, got $response"
    track_test_failure
fi

# Get admin token
print_info "2. Logging in as admin"
ADMIN_TOKEN=$(get_admin_token)
if [ -z "$ADMIN_TOKEN" ]; then
    print_fail "Failed to get admin token"
    exit 1
fi
print_success "Admin logged in"

# 3. List initial secrets (should include BACKEND_INTERNAL_URL)
print_info "3. Listing initial secrets"
response=$(curl -s "$API_BASE/secrets" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

if echo "$response" | jq -e '.secrets | map(select(.key == "INSFORGE_INTERNAL_URL")) | length == 1' >/dev/null 2>&1; then
    print_success "System secret INSFORGE_INTERNAL_URL exists"
else
    print_fail "Expected INSFORGE_INTERNAL_URL secret to exist"
    echo "Response: $response"
    track_test_failure
fi

# 4. Create a test secret
print_info "4. Creating a test secret"
TEST_KEY="TEST_SECRET_$(date +%s)"
TEST_VALUE="test_value_12345"

response=$(curl -s "$API_BASE/secrets" \
    -X POST \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"key\": \"$TEST_KEY\", \"value\": \"$TEST_VALUE\"}")

if echo "$response" | grep -q "success.*true"; then
    print_success "Secret created successfully"
    SECRET_ID=$(echo "$response" | jq -r '.id')
else
    print_fail "Failed to create secret"
    echo "Response: $response"
    track_test_failure
fi

# 5. Get the secret value
print_info "5. Getting the test secret value"
response=$(curl -s "$API_BASE/secrets/$TEST_KEY" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

if echo "$response" | jq -e ".value == \"$TEST_VALUE\"" >/dev/null 2>&1; then
    print_success "Secret value retrieved correctly"
else
    print_fail "Failed to retrieve secret value"
    echo "Response: $response"
    track_test_failure
fi

# 6. Update the secret
print_info "6. Updating the test secret"
UPDATE_VALUE="updated_value_67890"

response=$(curl -s "$API_BASE/secrets/$TEST_KEY" \
    -X PUT \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"value\": \"$UPDATE_VALUE\"}")

if echo "$response" | grep -q "success.*true"; then
    print_success "Secret updated successfully"
else
    print_fail "Failed to update secret"
    echo "Response: $response"
    track_test_failure
fi

# 7. Verify update
print_info "7. Verifying secret update"
response=$(curl -s "$API_BASE/secrets/$TEST_KEY" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

if echo "$response" | jq -e ".value == \"$UPDATE_VALUE\"" >/dev/null 2>&1; then
    print_success "Secret value updated correctly"
else
    print_fail "Secret value not updated"
    echo "Response: $response"
    track_test_failure
fi

# 8. List secrets and verify our test secret exists
print_info "8. Verifying secret exists in list"
response=$(curl -s "$API_BASE/secrets" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

if echo "$response" | jq -e ".secrets[] | select(.key == \"$TEST_KEY\")" >/dev/null 2>&1; then
    print_success "Test secret found in list"
    IS_ACTIVE=$(echo "$response" | jq -r ".secrets[] | select(.key == \"$TEST_KEY\") | .isActive")
    if [ "$IS_ACTIVE" = "true" ]; then
        print_success "Secret is active"
    else
        print_fail "Secret is not active"
        track_test_failure
    fi
else
    print_fail "Test secret not found in list"
    echo "Response: $response"
    track_test_failure
fi

# 9. Test edge function with secret
print_info "9. Creating edge function to test secret access"

# Create a simple function that returns the secret
cat > /tmp/test-secrets-function.js << EOF
module.exports = async function(request) {
  const testSecret = Deno.env.get('$TEST_KEY');
  const systemSecret = Deno.env.get('INSFORGE_INTERNAL_URL');
  
  return new Response(JSON.stringify({
    testSecretFound: !!testSecret,
    testSecretValue: testSecret === '$UPDATE_VALUE',
    systemSecretFound: !!systemSecret,
    denoEnvWorks: typeof Deno.env.get === 'function'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
EOF

# Create the function
FUNCTION_SLUG="test-secrets-fn-$(date +%s)"
response=$(curl -s -X POST "$API_BASE/functions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"slug\": \"$FUNCTION_SLUG\",
        \"name\": \"Test Secrets Function\",
        \"code\": $(jq -Rs . < /tmp/test-secrets-function.js),
        \"status\": \"active\"
    }")

if echo "$response" | grep -q "id"; then
    print_success "Edge function created"

    # Restart Deno to pick up new secrets (allow failure in CI)
    docker compose restart deno >/dev/null 2>&1 || true
    sleep 3
    
    # Test the function
    print_info "10. Testing edge function secret access"
    response=$(curl -s "$DENO_BASE/$FUNCTION_SLUG" || true)

    if [ -z "$response" ]; then
        print_info "Skipping edge function test - Deno not accessible (CI environment)"
    else
        if echo "$response" | jq -e '.testSecretValue == true and .systemSecretFound == true' >/dev/null 2>&1; then
            print_success "Edge function can access secrets"
        else
            print_fail "Edge function cannot access secrets properly"
            echo "Response: $response"
            track_test_failure
        fi
    fi
    
    # Clean up function
    curl -s -X DELETE "$API_BASE/functions/$FUNCTION_SLUG" \
        -H "Authorization: Bearer $ADMIN_TOKEN" >/dev/null 2>&1
else
    print_fail "Failed to create edge function"
    echo "Response: $response"
    track_test_failure
fi

# 11. Test soft delete (mark as inactive)
print_info "11. Deleting test secret (soft delete)"
response=$(curl -s -X DELETE "$API_BASE/secrets/$TEST_KEY" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

if echo "$response" | grep -q "success.*true\|deleted"; then
    print_success "Secret deleted successfully"
else
    print_fail "Failed to delete secret"
    echo "Response: $response"
    track_test_failure
fi

# 12. Verify secret is marked as inactive
print_info "12. Verifying secret is marked as inactive"
response=$(curl -s "$API_BASE/secrets" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

if echo "$response" | jq -e ".secrets[] | select(.key == \"$TEST_KEY\")" >/dev/null 2>&1; then
    IS_ACTIVE=$(echo "$response" | jq -r ".secrets[] | select(.key == \"$TEST_KEY\") | .isActive")
    if [ "$IS_ACTIVE" = "false" ]; then
        print_success "Secret is marked as inactive (soft delete)"
    else
        print_fail "Secret is still active after deletion"
        echo "isActive: $IS_ACTIVE"
        track_test_failure
    fi
else
    # Secret might be completely hidden after deletion, which is also fine
    print_success "Secret no longer visible after deletion"
fi

# 13. Test that deleted secret returns 404
print_info "13. Testing that deleted secret returns 404"
response_code=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/secrets/$TEST_KEY" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

if [ "$response_code" = "404" ]; then
    print_success "Deleted secret returns 404"
else
    print_fail "Expected 404 for deleted secret, got $response_code"
    track_test_failure
fi


# Clean up
rm -f /tmp/test-secrets-function.js

# Summary
echo ""
print_blue "=========================================="
print_blue "Secrets API Test Complete"
print_blue "=========================================="

exit $TEST_FAILED