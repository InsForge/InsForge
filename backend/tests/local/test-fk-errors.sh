#!/bin/bash

# Simple FK error handling test - covers main scenarios we handle

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

print_blue "🔗 Testing FK error handling..."

API_BASE="$TEST_API_BASE"

# Get admin token for table operations
ADMIN_TOKEN=$(get_admin_token)
if [ -z "$ADMIN_TOKEN" ]; then
    print_fail "Could not get admin token"
    exit 1
fi

# Dynamic table names
USERS_TABLE="users_$(date +%s)"
POSTS_TABLE="posts_$(date +%s)"

# Register for cleanup
register_test_table "$USERS_TABLE"
register_test_table "$POSTS_TABLE"

TOTAL_TESTS=0
PASSED_TESTS=0

test_fk() {
    local method=$1 endpoint=$2 data=$3 desc=$4 expected=${5:-200}
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    print_info "Test $TOTAL_TESTS: $desc"
    
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_BASE$endpoint" \
        -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" ${data:+-d "$data"})
    
    status=$(echo "$response" | tail -n 1)
    
    if [ "$status" = "$expected" ]; then
        print_success "✅ ($status)"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        print_fail "❌ Expected $expected, got $status"
    fi
    echo ""
}

main_test() {
    print_info "Test tables: $USERS_TABLE, $POSTS_TABLE"
    
    # Setup tables
    test_fk "POST" "/database/tables" \
        "{\"tableName\":\"$USERS_TABLE\",\"rlsEnabled\":false,\"columns\":[{\"columnName\":\"name\",\"type\":\"string\",\"isNullable\":false,\"isUnique\":false}]}" \
        "Create users table" 201
    
    test_fk "POST" "/database/tables" \
        "{\"tableName\":\"$POSTS_TABLE\",\"rlsEnabled\":false,\"columns\":[{\"columnName\":\"author_id\",\"type\":\"uuid\",\"isNullable\":true,\"isUnique\":false}]}" \
        "Create posts table" 201
    
    # Test our error handling
    test_fk "PATCH" "/database/tables/$POSTS_TABLE/schema" \
        "{\"addFkeyColumns\":[{\"columnName\":\"author_id\",\"foreignKey\":{\"referenceTable\":\"fake_table\",\"referenceColumn\":\"id\",\"onDelete\":\"CASCADE\",\"onUpdate\":\"CASCADE\"}}]}" \
        "Non-existent table → 400" 400
    
    test_fk "PATCH" "/database/tables/$POSTS_TABLE/schema" \
        "{\"addFkeyColumns\":[{\"columnName\":\"author_id\",\"foreignKey\":{\"referenceTable\":\"$USERS_TABLE\",\"referenceColumn\":\"name\",\"onDelete\":\"CASCADE\",\"onUpdate\":\"CASCADE\"}}]}" \
        "Type mismatch → 400" 400
    
    test_fk "PATCH" "/database/tables/$POSTS_TABLE/schema" \
        "{\"addColumns\":[{\"columnName\":\"cat_id\",\"type\":\"uuid\",\"isNullable\":true,\"isUnique\":false,\"foreignKey\":{\"referenceTable\":\"fake_cats\",\"referenceColumn\":\"id\",\"onDelete\":\"CASCADE\",\"onUpdate\":\"CASCADE\"}}]}" \
        "New column with non-existent table → 400" 400
    
    # Valid FK should work
    test_fk "PATCH" "/database/tables/$POSTS_TABLE/schema" \
        "{\"addFkeyColumns\":[{\"columnName\":\"author_id\",\"foreignKey\":{\"referenceTable\":\"$USERS_TABLE\",\"referenceColumn\":\"id\",\"onDelete\":\"CASCADE\",\"onUpdate\":\"CASCADE\"}}]}" \
        "Valid FK constraint → 200" 200
    
    # Summary
    print_blue "Results: $PASSED_TESTS/$TOTAL_TESTS passed"
    if [ $PASSED_TESTS -eq $TOTAL_TESTS ]; then
        print_success "🎉 FK error handling working correctly!"
        return 0
    else
        print_fail "❌ Some FK error tests failed"
        return 1
    fi
}

# Check requirements
if ! curl -s "$API_BASE/health" > /dev/null; then
    print_fail "Server not running at $API_BASE"  
    exit 1
fi

main_test