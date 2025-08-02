#!/bin/bash

# Fixed Test Script for InsForge Serverless Functions

echo "🧪 InsForge Serverless Functions Test Suite"
echo "========================================"
echo ""

# Configuration
API_BASE="${API_BASE:-http://localhost:7130}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-change-this-password}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
function test_pass() {
    echo -e "${GREEN}✓ $1${NC}"
    ((TESTS_PASSED++))
}

function test_fail() {
    echo -e "${RED}✗ $1${NC}"
    echo "  Details: $2"
    ((TESTS_FAILED++))
}

function section() {
    echo -e "\n${BLUE}▶ $1${NC}"
    echo "----------------------------------------"
}

# Start tests
section "1. Authentication"

AUTH_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/auth/admin/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$ADMIN_EMAIL\", \"password\": \"$ADMIN_PASSWORD\"}")

HTTP_CODE=$(echo "$AUTH_RESPONSE" | tail -n1)
BODY=$(echo "$AUTH_RESPONSE" | sed '$d')
TOKEN=$(echo $BODY | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ "$HTTP_CODE" = "200" ] && [ -n "$TOKEN" ]; then
    test_pass "Admin login"
else
    test_fail "Admin login" "Status: $HTTP_CODE"
    exit 1
fi

section "2. Function CRUD Operations"

# Use unique names with timestamp
TIMESTAMP=$(date +%s)
FUNC_NAME="test-func-$TIMESTAMP"
FUNC_SLUG="test-func-$TIMESTAMP"  # slug matches name

# Create function
CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/functions" \
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
    test_pass "Create function"
else
    test_fail "Create function" "Status: $HTTP_CODE"
    BODY=$(echo "$CREATE_RESPONSE" | sed '$d')
    echo "  Response: $BODY"
fi

# Get function
GET_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/api/functions/$FUNC_SLUG" \
  -H "Authorization: Bearer $TOKEN")

HTTP_CODE=$(echo "$GET_RESPONSE" | tail -n1)
BODY=$(echo "$GET_RESPONSE" | sed '$d')
if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q '"code"'; then
    test_pass "Get function"
else
    test_fail "Get function" "Status: $HTTP_CODE"
fi

# Update function
UPDATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "$API_BASE/api/functions/$FUNC_SLUG" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"code": "module.exports = async function(req) { return new Response(\"Updated!\"); }"}')

HTTP_CODE=$(echo "$UPDATE_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "200" ]; then
    test_pass "Update function"
else
    test_fail "Update function" "Status: $HTTP_CODE"
fi

# List functions
LIST_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/api/functions" \
  -H "Authorization: Bearer $TOKEN")

HTTP_CODE=$(echo "$LIST_RESPONSE" | tail -n1)
BODY=$(echo "$LIST_RESPONSE" | sed '$d')
if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q "$FUNC_SLUG"; then
    test_pass "List functions"
else
    test_fail "List functions" "Status: $HTTP_CODE or missing function"
fi

section "3. Function Execution"

# Execute updated function
EXEC_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_BASE/functions/$FUNC_SLUG")
HTTP_CODE=$(echo "$EXEC_RESPONSE" | tail -n1)
BODY=$(echo "$EXEC_RESPONSE" | sed '$d')
if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q "Updated!"; then
    test_pass "Execute function"
else
    test_fail "Execute function" "Status: $HTTP_CODE, Body: $BODY"
fi

# Create POST function
POST_FUNC="post-func-$TIMESTAMP"
POST_CREATE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/functions" \
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
    test_pass "Create POST function"
else
    test_fail "Create POST function" "Status: $HTTP_CODE"
fi

# Test POST execution
POST_EXEC=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/functions/$POST_FUNC" \
  -H "Content-Type: application/json" \
  -d '{"value": 21}')

HTTP_CODE=$(echo "$POST_EXEC" | tail -n1)
BODY=$(echo "$POST_EXEC" | sed '$d')
if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q '"result":42'; then
    test_pass "POST execution"
else
    test_fail "POST execution" "Status: $HTTP_CODE, Body: $BODY"
fi

section "4. Error Status Code Preservation"

# Create function that returns 403 Forbidden
FORBIDDEN_FUNC="forbidden-func-$TIMESTAMP"
FORBIDDEN_CREATE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/functions" \
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
    EXEC_403=$(curl -s -w "\n%{http_code}" "$API_BASE/functions/$FORBIDDEN_FUNC")
    HTTP_CODE=$(echo "$EXEC_403" | tail -n1)
    BODY=$(echo "$EXEC_403" | sed '$d')
    if [ "$HTTP_CODE" = "403" ] && echo "$BODY" | grep -q "Access Forbidden"; then
        test_pass "403 status preserved"
    else
        test_fail "403 status preserved" "Expected 403, got $HTTP_CODE"
    fi
else
    test_fail "Create 403 function" "Status: $HTTP_CODE"
fi

# Create function that throws 401 Unauthorized
UNAUTH_FUNC="unauth-func-$TIMESTAMP"
UNAUTH_CREATE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/functions" \
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
    EXEC_401=$(curl -s -w "\n%{http_code}" "$API_BASE/functions/$UNAUTH_FUNC")
    HTTP_CODE=$(echo "$EXEC_401" | tail -n1)
    BODY=$(echo "$EXEC_401" | sed '$d')
    if [ "$HTTP_CODE" = "401" ] && echo "$BODY" | grep -q "Unauthorized"; then
        test_pass "401 status preserved (thrown)"
    else
        test_fail "401 status preserved (thrown)" "Expected 401, got $HTTP_CODE"
    fi
else
    test_fail "Create 401 function" "Status: $HTTP_CODE"
fi

# Create validation function that returns 400 Bad Request
VALIDATION_FUNC="validation-func-$TIMESTAMP"
VALIDATION_CREATE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/functions" \
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
    EXEC_400=$(curl -s -w "\n%{http_code}" "$API_BASE/functions/$VALIDATION_FUNC")
    HTTP_CODE=$(echo "$EXEC_400" | tail -n1)
    BODY=$(echo "$EXEC_400" | sed '$d')
    if [ "$HTTP_CODE" = "400" ] && echo "$BODY" | grep -q "Name parameter required"; then
        test_pass "400 status preserved"
    else
        test_fail "400 status preserved" "Expected 400, got $HTTP_CODE"
    fi
    
    # Test with valid param returns 200
    EXEC_200=$(curl -s -w "\n%{http_code}" "$API_BASE/functions/$VALIDATION_FUNC?name=World")
    HTTP_CODE=$(echo "$EXEC_200" | tail -n1)
    BODY=$(echo "$EXEC_200" | sed '$d')
    if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q "Hello World"; then
        test_pass "Validation success (200)"
    else
        test_fail "Validation success" "Expected 200, got $HTTP_CODE"
    fi
else
    test_fail "Create validation function" "Status: $HTTP_CODE"
fi

# Create function with real JavaScript error (should be 500)
ERROR_FUNC="error-func-$TIMESTAMP"
ERROR_CREATE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/functions" \
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
    EXEC_500=$(curl -s -w "\n%{http_code}" "$API_BASE/functions/$ERROR_FUNC")
    HTTP_CODE=$(echo "$EXEC_500" | tail -n1)
    BODY=$(echo "$EXEC_500" | sed '$d')
    if [ "$HTTP_CODE" = "500" ] && echo "$BODY" | grep -q "Something went wrong"; then
        test_pass "500 for real errors"
    else
        test_fail "500 for real errors" "Expected 500, got $HTTP_CODE"
    fi
else
    test_fail "Create error function" "Status: $HTTP_CODE"
fi

section "5. Error Handling"

# Duplicate function
DUP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/functions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"name\": \"$FUNC_NAME\",
    \"slug\": \"$FUNC_SLUG\",
    \"code\": \"module.exports = async function(req) { return new Response('Dup'); }\"
  }")

HTTP_CODE=$(echo "$DUP_RESPONSE" | tail -n1)
if [ "$HTTP_CODE" = "409" ]; then
    test_pass "Duplicate rejection"
else
    test_fail "Duplicate rejection" "Expected 409, got $HTTP_CODE"
fi

# No auth
NO_AUTH=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/api/functions")
HTTP_CODE=$(echo "$NO_AUTH" | tail -n1)
if [ "$HTTP_CODE" = "401" ]; then
    test_pass "Auth required"
else
    test_fail "Auth required" "Expected 401, got $HTTP_CODE"
fi

# Non-existent function
NOT_FOUND=$(curl -s -w "\n%{http_code}" "$API_BASE/functions/does-not-exist-$TIMESTAMP")
HTTP_CODE=$(echo "$NOT_FOUND" | tail -n1)
if [ "$HTTP_CODE" = "404" ]; then
    test_pass "Function not found"
else
    test_fail "Function not found" "Expected 404, got $HTTP_CODE"
fi

section "6. Cleanup"

# Delete all test functions
for slug in "$FUNC_SLUG" "$POST_FUNC" "$FORBIDDEN_FUNC" "$UNAUTH_FUNC" "$VALIDATION_FUNC" "$ERROR_FUNC"; do
    DELETE_RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$API_BASE/api/functions/$slug" \
      -H "Authorization: Bearer $TOKEN")
    
    HTTP_CODE=$(echo "$DELETE_RESPONSE" | tail -n1)
    if [ "$HTTP_CODE" = "200" ]; then
        echo "  Deleted: $slug"
    fi
done

# Verify cleanup
VERIFY=$(curl -s -w "\n%{http_code}" "$API_BASE/functions/$FUNC_SLUG")
HTTP_CODE=$(echo "$VERIFY" | tail -n1)
if [ "$HTTP_CODE" = "404" ]; then
    test_pass "Cleanup verified"
else
    test_fail "Cleanup verification" "Expected 404, got $HTTP_CODE"
fi

# Summary
echo -e "\n========================================"
echo -e "${BLUE}Test Summary${NC}"
echo "========================================"
echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "\n${RED}❌ Some tests failed${NC}"
    exit 1
fi