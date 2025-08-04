#!/bin/bash

# Simple FK error handling test - covers main scenarios we handle

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

print_blue "🔗 Testing FK error handling..."

API_BASE="$TEST_API_BASE"
API_KEY="$INSFORGE_API_KEY"

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
        -H "x-api-key: $API_KEY" -H "Content-Type: application/json" ${data:+-d "$data"})
    
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
        "{\"table_name\":\"$USERS_TABLE\",\"rls_enabled\":false,\"columns\":[{\"name\":\"name\",\"type\":\"string\",\"nullable\":false,\"is_unique\":false}]}" \
        "Create users table" 201
    
    test_fk "POST" "/database/tables" \
        "{\"table_name\":\"$POSTS_TABLE\",\"rls_enabled\":false,\"columns\":[{\"name\":\"author_id\",\"type\":\"uuid\",\"nullable\":true,\"is_unique\":false}]}" \
        "Create posts table" 201
    
    # Test our error handling
    test_fk "PATCH" "/database/tables/$POSTS_TABLE" \
        "{\"add_fkey_columns\":[{\"name\":\"author_id\",\"foreign_key\":{\"reference_table\":\"fake_table\",\"reference_column\":\"id\",\"on_delete\":\"CASCADE\",\"on_update\":\"CASCADE\"}}]}" \
        "Non-existent table → 400" 400
    
    test_fk "PATCH" "/database/tables/$POSTS_TABLE" \
        "{\"add_fkey_columns\":[{\"name\":\"author_id\",\"foreign_key\":{\"reference_table\":\"$USERS_TABLE\",\"reference_column\":\"name\",\"on_delete\":\"CASCADE\",\"on_update\":\"CASCADE\"}}]}" \
        "Type mismatch → 400" 400
    
    test_fk "PATCH" "/database/tables/$POSTS_TABLE" \
        "{\"add_columns\":[{\"name\":\"cat_id\",\"type\":\"uuid\",\"nullable\":true,\"is_unique\":false,\"foreign_key\":{\"reference_table\":\"fake_cats\",\"reference_column\":\"id\",\"on_delete\":\"CASCADE\",\"on_update\":\"CASCADE\"}}]}" \
        "New column with non-existent table → 400" 400
    
    # Valid FK should work
    test_fk "PATCH" "/database/tables/$POSTS_TABLE" \
        "{\"add_fkey_columns\":[{\"name\":\"author_id\",\"foreign_key\":{\"reference_table\":\"$USERS_TABLE\",\"reference_column\":\"id\",\"on_delete\":\"CASCADE\",\"on_update\":\"CASCADE\"}}]}" \
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
if [ -z "$INSFORGE_API_KEY" ]; then
    print_fail "INSFORGE_API_KEY required"
    exit 1
fi

if ! curl -s "$API_BASE/health" > /dev/null; then
    print_fail "Server not running at $API_BASE"  
    exit 1
fi

main_test