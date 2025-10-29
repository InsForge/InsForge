#!/bin/bash

# Serverless Functions test script

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing serverless functions..."

API_BASE="$TEST_API_BASE"
ADMIN_TOKEN=""
FUNCTION_SLUG="test_func_$(date +%s)"

# Get admin token
echo "🔑 Getting admin token..."
ADMIN_TOKEN=$(get_admin_token)

if [ -z "$ADMIN_TOKEN" ]; then
    print_fail "Failed to get admin token"
    exit 1
fi
print_success "Got admin token"
echo ""

# 1. Create function
echo "📝 Creating serverless function..."
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
    print_success "Function created"
    echo "Slug: $FUNCTION_SLUG"
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
else
    print_fail "Failed to get function details (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 4. Update function
echo "✏️ Updating function..."
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

# 5. Delete function
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
