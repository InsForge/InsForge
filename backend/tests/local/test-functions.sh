#!/bin/bash

# Serverless Functions test script

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing serverless functions..."

API_BASE="$TEST_API_BASE"
if [[ "$API_BASE" == */api ]]; then
    RUNTIME_BASE="${API_BASE%/api}"
else
    RUNTIME_BASE="$API_BASE"
fi
ADMIN_TOKEN=""
FUNCTION_SLUG="test_func_$(date +%s)"
ANON_TOKEN="$ANON_KEY"

# Get admin token
echo "🔑 Getting admin token..."
ADMIN_TOKEN=$(get_admin_token)

if [ -z "$ADMIN_TOKEN" ]; then
    print_fail "Failed to get admin token"
    exit 1
fi
print_success "Got admin token"
echo ""

# 1. Create function with default auth (should be 'user')
echo "📝 Creating serverless function with default auth..."
create_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/functions" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "name": "Test Function",
        "slug": "'$FUNCTION_SLUG'",
        "code": "export default async function handler(req) { return new Response(\"Hello World\"); }",
        "status": "active"
    }')

status=$(echo "$create_response" | tail -n 1)
body=$(echo "$create_response" | sed '$d')

if [ "$status" -eq 201 ]; then
    print_success "Function created with default auth"
    echo "Slug: $FUNCTION_SLUG"
    # Verify auth defaults to 'user'
    if echo "$body" | grep -q '"auth":"user"'; then
        print_success "Auth field correctly defaults to 'user'"
    else
        print_fail "Auth field did not default to 'user'"
        echo "Response: $body"
    fi
else
    print_fail "Failed to create function (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 2. List all functions
echo "📋 Listing all functions..."
list_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/functions" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$list_response" | tail -n 1)
body=$(echo "$list_response" | sed '$d')

if [ "$status" -eq 200 ] && echo "$body" | grep -q "$FUNCTION_SLUG"; then
    print_success "Listed functions successfully"
    # Verify auth field is present in list
    if echo "$body" | grep -q '"auth"'; then
        print_success "Auth field present in function list"
    fi
else
    print_fail "Failed to list functions (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 3. Get function details
echo "🔍 Getting function details..."
get_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/functions/$FUNCTION_SLUG" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$get_response" | tail -n 1)
body=$(echo "$get_response" | sed '$d')

if [ "$status" -eq 200 ] && echo "$body" | grep -q '"code"'; then
    print_success "Retrieved function details with code"
    # Verify auth field exists
    if echo "$body" | grep -q '"auth"'; then
        auth_value=$(echo "$body" | sed -n 's/.*"auth":"\([^"]*\)".*/\1/p')
        print_success "Function has auth policy: $auth_value"
    fi
else
    print_fail "Failed to get function details (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 4. Invoke function without token (auth='user' policy should require auth)
echo "🔓 Testing function invocation without token (auth='user' policy)..."
invoke_response=$(curl -s -w "\n%{http_code}" -X GET "$RUNTIME_BASE/functions/$FUNCTION_SLUG")

status=$(echo "$invoke_response" | tail -n 1)
if [ "$status" -eq 401 ]; then
    print_success "Unauthenticated request correctly rejected with 401"
else
    print_fail "Expected 401 for unauthenticated request, got $status"
    track_test_failure
fi
echo ""

# 5. Update function to admin-only auth
echo "✏️ Updating function to admin-only (auth='admin')..."
update_response=$(curl -s -w "\n%{http_code}" -X PUT "$API_BASE/functions/$FUNCTION_SLUG" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "auth": "admin"
    }')

status=$(echo "$update_response" | tail -n 1)
body=$(echo "$update_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Function updated to admin-only auth"
    if echo "$body" | grep -q '"auth":"admin"'; then
        print_success "Auth field correctly updated to 'admin'"
    fi
else
    print_fail "Failed to update function auth (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 6. Update function to public auth
echo "✏️ Updating function to public (auth='none')..."
update_response=$(curl -s -w "\n%{http_code}" -X PUT "$API_BASE/functions/$FUNCTION_SLUG" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "auth": "none"
    }')

status=$(echo "$update_response" | tail -n 1)
body=$(echo "$update_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Function updated to public auth"
    if echo "$body" | grep -q '"auth":"none"'; then
        print_success "Auth field correctly updated to 'none'"
    fi
else
    print_fail "Failed to update function auth (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 7. Update function code and status
echo "✏️ Updating function code and status..."
update_response=$(curl -s -w "\n%{http_code}" -X PUT "$API_BASE/functions/$FUNCTION_SLUG" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "code": "export default async function handler(req) { return new Response(\"Updated\"); }",
        "status": "draft"
    }')

status=$(echo "$update_response" | tail -n 1)
body=$(echo "$update_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Function updated"
else
    print_fail "Failed to update function (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 8. Delete function
echo "🗑️ Deleting function..."
delete_response=$(curl -s -w "\n%{http_code}" -X DELETE "$API_BASE/functions/$FUNCTION_SLUG" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$delete_response" | tail -n 1)
body=$(echo "$delete_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Function deleted"
else
    print_fail "Failed to delete function (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

print_success "🎉 Serverless functions test completed!"
