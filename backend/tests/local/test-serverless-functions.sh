#!/bin/bash

# Fixed Test Script for InsForge Serverless Functions

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Source the test configuration
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 InsForge Serverless Functions Test Suite"
echo "========================================"
echo ""

# Use configuration from test-config.sh
API_BASE="$TEST_API_BASE"
# Base URL without /api prefix for function execution
BASE_URL="${TEST_API_BASE%/api}"

# Helper function for section headers
function section() {
    echo -e "\n${BLUE}▶ $1${NC}"
    echo "----------------------------------------"
}

# Start tests
section "1. Authentication"

TOKEN=$(get_admin_token)

if [ -n "$TOKEN" ]; then
    print_success "Admin login"
else
    print_fail "Admin login - Could not obtain admin token"
    exit 1
fi

section "2. Function CRUD Operations"

# Use unique names with timestamp
TIMESTAMP=$(date +%s)
FUNC_NAME="test-func-$TIMESTAMP"
FUNC_SLUG="test-func-$TIMESTAMP"  # slug matches name

# Create function
CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/functions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\": \"$FUNC_NAME\",
    \"slug\": \"$FUNC_SLUG\",
    \"code\": \"module.exports = async function(req) { return new Response('Hello World'); }\",
    \"status\": \"active\"
  }")

HTTP_CODE=$(echo "$CREATE_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "201" ]; then
    print_success "Create function"
else
    print_fail "Create function - Status: $HTTP_CODE"
    BODY=$(echo "$CREATE_RESPONSE" | sed '$d')
    echo "  Response: $BODY"
fi

# Get function
GET_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/functions/$FUNC_SLUG" \
  -H "Authorization: Bearer $TOKEN")

HTTP_CODE=$(echo "$GET_RESPONSE" | tail -n1)
BODY=$(echo "$GET_RESPONSE" | sed '$d')
if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q '"code"'; then
    print_success "Get function"
else
    print_fail "Get function - Status: $HTTP_CODE"
fi

# Update function
UPDATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "$API_BASE/functions/$FUNC_SLUG" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"code": "module.exports = async function(req) { return new Response(\"Updated!\"); }"}')

HTTP_CODE=$(echo "$UPDATE_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "200" ]; then
    print_success "Update function"
else
    print_fail "Update function - Status: $HTTP_CODE"
fi

# List functions
LIST_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/functions" \
  -H "Authorization: Bearer $TOKEN")

HTTP_CODE=$(echo "$LIST_RESPONSE" | tail -n1)
BODY=$(echo "$LIST_RESPONSE" | sed '$d')
if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q "$FUNC_SLUG"; then
    print_success "List functions"
else
    print_fail "List functions - Status: $HTTP_CODE or missing function"
fi

section "3. Function Execution"

# Execute updated function
EXEC_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/functions/$FUNC_SLUG")
HTTP_CODE=$(echo "$EXEC_RESPONSE" | tail -n1)
BODY=$(echo "$EXEC_RESPONSE" | sed '$d')
if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q "Updated!"; then
    print_success "Execute function"
else
    print_fail "Execute function - Status: $HTTP_CODE, Body: $BODY"
fi

# Create POST function
POST_FUNC="post-func-$TIMESTAMP"
POST_CREATE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/functions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\": \"$POST_FUNC\",
    \"slug\": \"$POST_FUNC\",
    \"code\": \"module.exports = async function(req) { if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 }); const data = await req.json(); return new Response(JSON.stringify({ result: data.value * 2 }), { headers: { 'Content-Type': 'application/json' } }); }\",
    \"status\": \"active\"
  }")

HTTP_CODE=$(echo "$POST_CREATE" | tail -n1)
if [ "$HTTP_CODE" = "201" ]; then
    print_success "Create POST function"
else
    print_fail "Create POST function - Status: $HTTP_CODE"
fi

# Test POST execution
POST_EXEC=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/functions/$POST_FUNC" \
  -H "Content-Type: application/json" \
  -d '{"value": 21}')

HTTP_CODE=$(echo "$POST_EXEC" | tail -n1)
BODY=$(echo "$POST_EXEC" | sed '$d')
if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q '"result":42'; then
    print_success "POST execution"
else
    print_fail "POST execution - Status: $HTTP_CODE, Body: $BODY"
fi

section "4. Error Status Code Preservation"

# Create function that returns 403 Forbidden
FORBIDDEN_FUNC="forbidden-func-$TIMESTAMP"
FORBIDDEN_CREATE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/functions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\": \"$FORBIDDEN_FUNC\",
    \"slug\": \"$FORBIDDEN_FUNC\",
    \"code\": \"module.exports = async function(req) { return new Response(JSON.stringify({ error: 'Access Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } }); }\",
    \"status\": \"active\"
  }")

HTTP_CODE=$(echo "$FORBIDDEN_CREATE" | tail -n1)
if [ "$HTTP_CODE" = "201" ]; then
    # Test execution returns 403
    EXEC_403=$(curl -s -w "\n%{http_code}" "$BASE_URL/functions/$FORBIDDEN_FUNC")
    HTTP_CODE=$(echo "$EXEC_403" | tail -n1)
    BODY=$(echo "$EXEC_403" | sed '$d')
    if [ "$HTTP_CODE" = "403" ] && echo "$BODY" | grep -q "Access Forbidden"; then
        print_success "403 status preserved"
    else
        print_fail "403 status preserved - Expected 403, got $HTTP_CODE"
    fi
else
    print_fail "Create 403 function - Status: $HTTP_CODE"
fi

# Create function that throws 401 Unauthorized
UNAUTH_FUNC="unauth-func-$TIMESTAMP"
UNAUTH_CREATE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/functions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\": \"$UNAUTH_FUNC\",
    \"slug\": \"$UNAUTH_FUNC\",
    \"code\": \"module.exports = async function(req) { throw new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } }); }\",
    \"status\": \"active\"
  }")

HTTP_CODE=$(echo "$UNAUTH_CREATE" | tail -n1)
if [ "$HTTP_CODE" = "201" ]; then
    # Test execution returns 401
    EXEC_401=$(curl -s -w "\n%{http_code}" "$BASE_URL/functions/$UNAUTH_FUNC")
    HTTP_CODE=$(echo "$EXEC_401" | tail -n1)
    BODY=$(echo "$EXEC_401" | sed '$d')
    if [ "$HTTP_CODE" = "401" ] && echo "$BODY" | grep -q "Unauthorized"; then
        print_success "401 status preserved (thrown)"
    else
        print_fail "401 status preserved (thrown) - Expected 401, got $HTTP_CODE"
    fi
else
    print_fail "Create 401 function - Status: $HTTP_CODE"
fi

# Create validation function that returns 400 Bad Request
VALIDATION_FUNC="validation-func-$TIMESTAMP"
VALIDATION_CREATE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/functions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\": \"$VALIDATION_FUNC\",
    \"slug\": \"$VALIDATION_FUNC\",
    \"code\": \"module.exports = async function(req) { const url = new URL(req.url); const name = url.searchParams.get('name'); if (!name) { return new Response(JSON.stringify({ error: 'Name parameter required' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); } return new Response(JSON.stringify({ message: 'Hello ' + name }), { headers: { 'Content-Type': 'application/json' } }); }\",
    \"status\": \"active\"
  }")

HTTP_CODE=$(echo "$VALIDATION_CREATE" | tail -n1)
if [ "$HTTP_CODE" = "201" ]; then
    # Test execution without param returns 400
    EXEC_400=$(curl -s -w "\n%{http_code}" "$BASE_URL/functions/$VALIDATION_FUNC")
    HTTP_CODE=$(echo "$EXEC_400" | tail -n1)
    BODY=$(echo "$EXEC_400" | sed '$d')
    if [ "$HTTP_CODE" = "400" ] && echo "$BODY" | grep -q "Name parameter required"; then
        print_success "400 status preserved"
    else
        print_fail "400 status preserved - Expected 400, got $HTTP_CODE"
    fi
    
    # Test with valid param returns 200
    EXEC_200=$(curl -s -w "\n%{http_code}" "$BASE_URL/functions/$VALIDATION_FUNC?name=World")
    HTTP_CODE=$(echo "$EXEC_200" | tail -n1)
    BODY=$(echo "$EXEC_200" | sed '$d')
    if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q "Hello World"; then
        print_success "Validation success (200)"
    else
        print_fail "Validation success - Expected 200, got $HTTP_CODE"
    fi
else
    print_fail "Create validation function - Status: $HTTP_CODE"
fi

# Create function with real JavaScript error (should be 500)
ERROR_FUNC="error-func-$TIMESTAMP"
ERROR_CREATE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/functions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\": \"$ERROR_FUNC\",
    \"slug\": \"$ERROR_FUNC\",
    \"code\": \"module.exports = async function(req) { throw new Error('Something went wrong'); }\",
    \"status\": \"active\"
  }")

HTTP_CODE=$(echo "$ERROR_CREATE" | tail -n1)
if [ "$HTTP_CODE" = "201" ]; then
    # Test execution returns 500
    EXEC_500=$(curl -s -w "\n%{http_code}" "$BASE_URL/functions/$ERROR_FUNC")
    HTTP_CODE=$(echo "$EXEC_500" | tail -n1)
    BODY=$(echo "$EXEC_500" | sed '$d')
    if [ "$HTTP_CODE" = "500" ] && echo "$BODY" | grep -q "Something went wrong"; then
        print_success "500 for real errors"
    else
        print_fail "500 for real errors - Expected 500, got $HTTP_CODE"
    fi
else
    print_fail "Create error function - Status: $HTTP_CODE"
fi

section "5. Error Handling"

# Duplicate function
DUP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/functions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\": \"$FUNC_NAME\",
    \"slug\": \"$FUNC_SLUG\",
    \"code\": \"module.exports = async function(req) { return new Response('Dup'); }\"
  }")

HTTP_CODE=$(echo "$DUP_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "409" ]; then
    print_success "Duplicate rejection"
else
    print_fail "Duplicate rejection - Expected 409, got $HTTP_CODE"
fi

# No auth
NO_AUTH=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/functions")
HTTP_CODE=$(echo "$NO_AUTH" | tail -n1)
if [ "$HTTP_CODE" = "401" ]; then
    print_success "Auth required"
else
    print_fail "Auth required - Expected 401, got $HTTP_CODE"
fi

# Non-existent function
NOT_FOUND=$(curl -s -w "\n%{http_code}" "$BASE_URL/functions/does-not-exist-$TIMESTAMP")
HTTP_CODE=$(echo "$NOT_FOUND" | tail -n1)
if [ "$HTTP_CODE" = "404" ]; then
    print_success "Function not found"
else
    print_fail "Function not found - Expected 404, got $HTTP_CODE"
fi

section "6. Cleanup"

# Delete all test functions
for slug in "$FUNC_SLUG" "$POST_FUNC" "$FORBIDDEN_FUNC" "$UNAUTH_FUNC" "$VALIDATION_FUNC" "$ERROR_FUNC"; do
    DELETE_RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$API_BASE/functions/$slug" \
      -H "Authorization: Bearer $TOKEN")
    
    HTTP_CODE=$(echo "$DELETE_RESPONSE" | tail -n1)
    if [ "$HTTP_CODE" = "200" ]; then
        echo "  Deleted: $slug"
    fi
done

# Verify cleanup
VERIFY=$(curl -s -w "\n%{http_code}" "$BASE_URL/functions/$FUNC_SLUG")
HTTP_CODE=$(echo "$VERIFY" | tail -n1)
if [ "$HTTP_CODE" = "404" ]; then
    print_success "Cleanup verified"
else
    print_fail "Cleanup verification - Expected 404, got $HTTP_CODE"
fi

# Test summary is handled by test-config.sh cleanup function