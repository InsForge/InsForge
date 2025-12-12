#!/bin/bash

# Test script for raw SQL endpoints - strict vs relaxed modes
# Tests the differences between /rawsql and /rawsql/unrestricted

# Configuration
BASE_URL="http://localhost:7130/api/database/advance"
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEiLCJlbWFpbCI6ImFkbWluQGV4YW1wbGUuY29tIiwicm9sZSI6InByb2plY3RfYWRtaW4iLCJpYXQiOjE3NTk5NzkxMjcsImV4cCI6MTc2MDU4MzkyN30.mVFDicZBzrBlPhfccfcjFaE9AcB09U3whRZOsC81ZSw"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "=============================================="
echo "RAW SQL MODES TEST SCRIPT"
echo "=============================================="
echo "Testing strict vs relaxed sanitization modes"
echo "=============================================="
echo ""

# Function to test endpoint
test_endpoint() {
    local mode="$1"
    local endpoint="$2"
    local test_name="$3"
    local query="$4"
    local expected_result="$5"  # "pass" or "fail"

    echo -e "${CYAN}[$mode] $test_name${NC}"
    echo "Query: $query"
    echo "Expected: $expected_result"

    # Make the API request
    RESPONSE=$(curl -s -w "\n:HTTP_CODE:%{http_code}" -X POST "$BASE_URL/$endpoint" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TOKEN" \
        -d "{\"query\": \"$query\"}" 2>&1)

    # Extract HTTP code and response body
    HTTP_CODE=$(echo "$RESPONSE" | grep ":HTTP_CODE:" | cut -d: -f3)
    RESPONSE_BODY=$(echo "$RESPONSE" | sed '/^:HTTP_CODE:/d')

    # Check result
    if [ "$expected_result" = "pass" ]; then
        if [ "$HTTP_CODE" = "200" ]; then
            echo -e "${GREEN}✓ PASS - Query executed successfully${NC}"
        else
            echo -e "${RED}✗ FAIL - Expected success but got error${NC}"
            echo "Response: $RESPONSE_BODY"
        fi
    else
        if [ "$HTTP_CODE" = "200" ]; then
            echo -e "${RED}✗ FAIL - Expected block but query executed${NC}"
            echo "Response: $RESPONSE_BODY"
        else
            echo -e "${GREEN}✓ PASS - Query blocked as expected${NC}"
            ERROR_MSG=$(echo "$RESPONSE_BODY" | jq -r '.message' 2>/dev/null || echo "$RESPONSE_BODY")
            echo "Error: $ERROR_MSG"
        fi
    fi

    echo ""
}

echo -e "${BLUE}=== STRICT MODE TESTS (/rawsql) ===${NC}"
echo ""

# Test 1: Strict mode allows SELECT from system table (read-only)
test_endpoint \
    "STRICT" \
    "rawsql" \
    "Allow SELECT from system table" \
    "SELECT * FROM system.secrets LIMIT 1;" \
    "pass"

# Test 2: Strict mode blocks system table INSERT
test_endpoint \
    "STRICT" \
    "rawsql" \
    "Block INSERT into system table" \
    "INSERT INTO system.secrets (name, value_ciphertext) VALUES ('test', 'value');" \
    "fail"

# Test 3: Strict mode blocks pg_catalog
test_endpoint \
    "STRICT" \
    "rawsql" \
    "Block pg_catalog query" \
    "SELECT * FROM pg_catalog.pg_tables LIMIT 1;" \
    "fail"

# Test 4: Strict mode blocks information_schema
test_endpoint \
    "STRICT" \
    "rawsql" \
    "Block information_schema query" \
    "SELECT * FROM information_schema.tables LIMIT 1;" \
    "fail"

# Test 5: Strict mode blocks INSERT into auth.users
test_endpoint \
    "STRICT" \
    "rawsql" \
    "Block INSERT into auth.users table" \
    "INSERT INTO auth.users (id, email, metadata) VALUES (gen_random_uuid(), 'test@example.com', '{}');" \
    "fail"

# Test 6: Strict mode allows regular table operations
test_endpoint \
    "STRICT" \
    "rawsql" \
    "Allow SELECT from auth.users table" \
    "SELECT COUNT(*) FROM auth.users;" \
    "pass"

echo -e "${BLUE}=== RELAXED MODE TESTS (/rawsql/unrestricted) ===${NC}"
echo ""

# Test 7: Relaxed mode allows SELECT from system table
test_endpoint \
    "RELAXED" \
    "rawsql/unrestricted" \
    "Allow SELECT from system table" \
    "SELECT * FROM system.secrets LIMIT 1;" \
    "pass"

# Test 8: Relaxed mode allows INSERT into system table
test_endpoint \
    "RELAXED" \
    "rawsql/unrestricted" \
    "Allow INSERT into system table" \
    "INSERT INTO system.audit_logs (actor, action, module) VALUES ('test_actor', 'TEST_ACTION', 'TEST_MODULE');" \
    "pass"

# Test 9: Relaxed mode blocks UPDATE system table
test_endpoint \
    "RELAXED" \
    "rawsql/unrestricted" \
    "Block UPDATE system table" \
    "UPDATE system.audit_logs SET actor = 'updated' WHERE action = 'TEST_ACTION';" \
    "fail"

# Test 10: Relaxed mode blocks DELETE FROM system table
test_endpoint \
    "RELAXED" \
    "rawsql/unrestricted" \
    "Block DELETE FROM system table" \
    "DELETE FROM system.audit_logs WHERE action = 'TEST_ACTION';" \
    "fail"

# Test 11: Relaxed mode blocks DROP system table
test_endpoint \
    "RELAXED" \
    "rawsql/unrestricted" \
    "Block DROP system table" \
    "DROP TABLE system.secrets;" \
    "fail"

# Test 12: Relaxed mode allows SELECT from auth.users
test_endpoint \
    "RELAXED" \
    "rawsql/unrestricted" \
    "Allow SELECT from auth.users table" \
    "SELECT COUNT(*) FROM auth.users;" \
    "pass"

# Test 13: Relaxed mode blocks DROP auth.users table
test_endpoint \
    "RELAXED" \
    "rawsql/unrestricted" \
    "Block DROP auth.users table" \
    "DROP TABLE auth.users;" \
    "fail"

# Test 14: Relaxed mode blocks RENAME auth.users table
test_endpoint \
    "RELAXED" \
    "rawsql/unrestricted" \
    "Block RENAME auth.users table" \
    "ALTER TABLE auth.users RENAME TO users_backup;" \
    "fail"

echo -e "${BLUE}=== BOTH MODES - DATABASE LEVEL BLOCKS ===${NC}"
echo ""

# Test 15: Strict mode blocks DROP DATABASE
test_endpoint \
    "STRICT" \
    "rawsql" \
    "Block DROP DATABASE" \
    "DROP DATABASE testdb;" \
    "fail"

# Test 16: Relaxed mode blocks DROP DATABASE
test_endpoint \
    "RELAXED" \
    "rawsql/unrestricted" \
    "Block DROP DATABASE" \
    "DROP DATABASE testdb;" \
    "fail"

# Test 17: Relaxed mode blocks pg_catalog
test_endpoint \
    "RELAXED" \
    "rawsql/unrestricted" \
    "Block pg_catalog access" \
    "SELECT * FROM pg_catalog.pg_tables LIMIT 1;" \
    "fail"

# Test 18: Relaxed mode blocks information_schema
test_endpoint \
    "RELAXED" \
    "rawsql/unrestricted" \
    "Block information_schema access" \
    "SELECT * FROM information_schema.tables LIMIT 1;" \
    "fail"

echo "=============================================="
echo "TEST SUMMARY"
echo "=============================================="
echo ""
echo -e "${GREEN}STRICT MODE (/rawsql):${NC}"
echo "  - ✅ Allows SELECT from system tables (read-only)"
echo "  - ❌ Blocks INSERT/UPDATE/DELETE/DROP/ALTER on system tables"
echo "  - ❌ Blocks ALL operations on auth.users table"
echo "  - ❌ Blocks pg_catalog and information_schema"
echo "  - ❌ Blocks database-level operations"
echo ""
echo -e "${GREEN}RELAXED MODE (/rawsql/unrestricted):${NC}"
echo "  - ✅ Allows SELECT from system tables"
echo "  - ✅ Allows INSERT into system tables"
echo "  - ✅ Allows SELECT from auth.users table"
echo "  - ❌ Blocks UPDATE of system tables"
echo "  - ❌ Blocks DELETE FROM system tables"
echo "  - ❌ Blocks DROP/ALTER/TRUNCATE system tables"
echo "  - ❌ Blocks DROP/RENAME auth.users table"
echo "  - ❌ Blocks pg_catalog and information_schema"
echo "  - ❌ Blocks database-level operations"
echo ""
echo -e "${CYAN}All tests completed!${NC}"
