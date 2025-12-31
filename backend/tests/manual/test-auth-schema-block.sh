#!/bin/bash

# Test script to verify auth schema blocking in raw SQL execution
# This tests the fix for issue #667: Prevent deletion of users via raw SQL

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

API_BASE="$TEST_API_BASE/database/advance"

echo "=============================================="
echo "🧪 Testing Auth Schema Blocking"
echo "=============================================="
echo "Verifying that raw SQL cannot access auth schema"
echo "=============================================="
echo ""

# Get admin token
echo -e "${BLUE}Getting admin token...${NC}"
TOKEN=$(get_admin_token)
if [ -z "$TOKEN" ]; then
    echo -e "${RED}❌ Failed to get admin token${NC}"
    echo "Make sure the backend is running and admin credentials are correct"
    exit 1
fi
echo -e "${GREEN}✅ Admin token obtained${NC}"
echo ""

# Function to test query
test_query() {
    local test_name="$1"
    local query="$2"
    local should_block="$3"  # "block" or "allow"
    
    echo -e "${CYAN}Test: $test_name${NC}"
    echo "Query: $query"
    
    RESPONSE=$(curl -s -w "\n:HTTP_CODE:%{http_code}" -X POST "$API_BASE/rawsql" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TOKEN" \
        -d "{\"query\": \"$query\"}" 2>&1)
    
    HTTP_CODE=$(echo "$RESPONSE" | grep ":HTTP_CODE:" | cut -d: -f3)
    RESPONSE_BODY=$(echo "$RESPONSE" | sed '/^:HTTP_CODE:/d')
    
    if [ "$should_block" = "block" ]; then
        if [ "$HTTP_CODE" = "403" ] || [ "$HTTP_CODE" = "200" ]; then
            # Check if it's actually blocked (403) or if error message contains auth schema message
            if [ "$HTTP_CODE" = "403" ] || echo "$RESPONSE_BODY" | grep -qi "auth schema\|forbidden\|restricted"; then
                echo -e "${GREEN}✅ PASS - Query blocked as expected${NC}"
                ERROR_MSG=$(echo "$RESPONSE_BODY" | jq -r '.message // .error // .' 2>/dev/null || echo "$RESPONSE_BODY")
                echo "   Response: ${ERROR_MSG:0:100}"
            else
                echo -e "${RED}❌ FAIL - Query should be blocked but wasn't${NC}"
                echo "   Response: $RESPONSE_BODY"
            fi
        else
            echo -e "${YELLOW}⚠️  Unexpected status code: $HTTP_CODE${NC}"
            echo "   Response: $RESPONSE_BODY"
        fi
    else
        if [ "$HTTP_CODE" = "200" ]; then
            echo -e "${GREEN}✅ PASS - Query allowed as expected${NC}"
        else
            echo -e "${RED}❌ FAIL - Query should be allowed but was blocked${NC}"
            echo "   Response: $RESPONSE_BODY"
        fi
    fi
    echo ""
}

echo -e "${BLUE}=== Testing Blocked Queries (auth schema) ===${NC}"
echo ""

# Test DELETE operations
test_query \
    "DELETE FROM auth.users" \
    "DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000001'" \
    "block"

test_query \
    "DELETE FROM quoted auth schema" \
    "DELETE FROM \"auth\".\"users\" WHERE id = '00000000-0000-0000-0000-000000000001'" \
    "block"

# Test UPDATE operations
test_query \
    "UPDATE auth.users" \
    "UPDATE auth.users SET email = 'test@example.com' WHERE id = '00000000-0000-0000-0000-000000000001'" \
    "block"

# Test INSERT operations
test_query \
    "INSERT INTO auth.users" \
    "INSERT INTO auth.users (email, \"emailVerified\") VALUES ('test@example.com', false)" \
    "block"

# Test TRUNCATE operations
test_query \
    "TRUNCATE auth.users" \
    "TRUNCATE TABLE auth.users" \
    "block"

# Test DROP operations
test_query \
    "DROP TABLE auth.users" \
    "DROP TABLE auth.users" \
    "block"

# Test SELECT operations (should also be blocked)
test_query \
    "SELECT FROM auth.users" \
    "SELECT * FROM auth.users LIMIT 1" \
    "block"

# Test ALTER operations
test_query \
    "ALTER TABLE auth.users" \
    "ALTER TABLE auth.users ADD COLUMN test_col TEXT" \
    "block"

# Test case variations
test_query \
    "Case insensitive AUTH.users" \
    "DELETE FROM AUTH.users WHERE id = '00000000-0000-0000-0000-000000000001'" \
    "block"

echo -e "${BLUE}=== Testing Allowed Queries (public schema) ===${NC}"
echo ""

# Test that legitimate queries still work
test_query \
    "SELECT from public schema" \
    "SELECT 1 as test" \
    "allow"

test_query \
    "SELECT from public users table (if exists)" \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'" \
    "allow"

echo -e "${GREEN}=============================================="
echo "✅ Test Complete"
echo "=============================================="
echo "${NC}All auth schema operations should be blocked!"
echo "Public schema operations should still work."
