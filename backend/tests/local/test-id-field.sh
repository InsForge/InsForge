#!/bin/bash

# Test script for ID field functionality

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Source the test configuration
source "$SCRIPT_DIR/../test-config.sh"

echo "=== Testing User Creation with ID Field ==="

# Use configuration from test-config.sh
API_URL="$TEST_API_BASE"

# Test users for cleanup tracking
USER1_EMAIL="${TEST_USER_EMAIL_PREFIX}id_test1_$(date +%s)@example.com"
USER2_EMAIL="${TEST_USER_EMAIL_PREFIX}id_test2_$(date +%s)@example.com"
USER3_EMAIL="${TEST_USER_EMAIL_PREFIX}id_test3_$(date +%s)@example.com"

# Register users for cleanup
register_test_user "$USER1_EMAIL"
register_test_user "$USER2_EMAIL"
register_test_user "$USER3_EMAIL"

# Test 1: Create user without ID (should auto-generate)
print_info "1. Creating user without ID (auto-generate):"
response1=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$USER1_EMAIL\",
    \"password\": \"password123\",
    \"name\": \"Test User 1\"
  }")

body1=$(echo "$response1" | sed '$d')
status1=$(echo "$response1" | tail -n 1)

if [ "$status1" -ge 200 ] && [ "$status1" -lt 300 ]; then
    print_success "User created without ID ($status1)"
    echo "Response: $body1" | head -c 200
    echo ""
else
    print_fail "User creation without ID failed ($status1)"
    echo "Error: $body1"
fi

# Test 2: Create user with custom ID
print_info "2. Creating user with custom ID:"
# Generate a valid UUID v4
CUSTOM_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
response2=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$CUSTOM_ID\",
    \"email\": \"$USER2_EMAIL\",
    \"password\": \"password123\",
    \"name\": \"Test User 2\"
  }")

body2=$(echo "$response2" | sed '$d')
status2=$(echo "$response2" | tail -n 1)

if [ "$status2" -ge 200 ] && [ "$status2" -lt 300 ]; then
    print_success "User created with custom ID ($status2)"
    echo "Response: $body2" | head -c 200
    echo ""
else
    print_fail "User creation with custom ID failed ($status2)"
    echo "Error: $body2"
fi

# Test 3: Try to create user with duplicate ID (should fail)
print_info "3. Creating user with duplicate ID (should fail):"
response3=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$CUSTOM_ID\",
    \"email\": \"$USER3_EMAIL\",
    \"password\": \"password123\",
    \"name\": \"Test User 3\"
  }")

body3=$(echo "$response3" | sed '$d')
status3=$(echo "$response3" | tail -n 1)

if [ "$status3" -ge 400 ] && [ "$status3" -lt 500 ]; then
    print_success "Duplicate ID correctly rejected ($status3)"
else
    print_fail "Duplicate ID was not rejected ($status3)"
    echo "Error: $body3"
fi

echo ""
echo "=== Testing Record Creation with ID Field ==="

# Get admin token for table creation
admin_token=$(get_admin_token)
if [ -z "$admin_token" ]; then
    print_fail "Could not get admin token for table creation"
fi

# Create a test table
TEST_TABLE="test_items_$(date +%s)"
register_test_table "$TEST_TABLE"

print_info "4. Creating test table: $TEST_TABLE"
create_response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/database/tables" \
  -H "Authorization: Bearer $admin_token" \
  -H "Content-Type: application/json" \
  -d "{
    \"table_name\": \"$TEST_TABLE\",
    \"columns\": [
      {\"name\": \"title\", \"type\": \"string\", \"nullable\": false},
      {\"name\": \"description\", \"type\": \"string\", \"nullable\": true},
      {\"name\": \"status\", \"type\": \"string\", \"nullable\": false}
    ]
  }")

create_body=$(echo "$create_response" | sed '$d')
create_status=$(echo "$create_response" | tail -n 1)

if [ "$create_status" -ge 200 ] && [ "$create_status" -lt 300 ]; then
    print_success "Test table created successfully ($create_status)"
    # Wait for the table to be created and synced
    sleep 1
else
    print_fail "Test table creation failed ($create_status)"
    echo "Error: $create_body"
fi

# Test 5: Create record without ID (should auto-generate)
print_info "5. Creating record without ID (auto-generate):"
record1_response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/database/records/$TEST_TABLE" \
  -H "Authorization: Bearer $admin_token" \
  -H "Content-Type: application/json" \
  -d '[{
    "title": "Test Item 1",
    "description": "This is a test item",
    "status": "active"
  }]')

record1_body=$(echo "$record1_response" | sed '$d')
record1_status=$(echo "$record1_response" | tail -n 1)

if [ "$record1_status" -ge 200 ] && [ "$record1_status" -lt 300 ]; then
    print_success "Record created without ID ($record1_status)"
    echo "Response: $record1_body" | head -c 200
    echo ""
else
    print_fail "Record creation without ID failed ($record1_status)"
    echo "Error: $record1_body"
fi

# Test 6: Create record with custom ID
print_info "6. Creating record with custom ID:"
# Generate a valid UUID v4
CUSTOM_RECORD_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
record2_response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/database/records/$TEST_TABLE" \
  -H "Authorization: Bearer $admin_token" \
  -H "Content-Type: application/json" \
  -d "[{
    \"id\": \"$CUSTOM_RECORD_ID\",
    \"title\": \"Test Item 2\",
    \"description\": \"This has a custom ID\",
    \"status\": \"active\"
  }]")

record2_body=$(echo "$record2_response" | sed '$d')
record2_status=$(echo "$record2_response" | tail -n 1)

if [ "$record2_status" -ge 200 ] && [ "$record2_status" -lt 300 ]; then
    print_success "Record created with custom ID ($record2_status)"
    echo "Response: $record2_body" | head -c 200
    echo ""
else
    print_fail "Record creation with custom ID failed ($record2_status)"
    echo "Error: $record2_body"
fi

# Test 7: Query records to verify IDs
print_info "7. Querying all records to verify IDs:"
query_response=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/database/records/$TEST_TABLE" \
  -H "Authorization: Bearer $admin_token")

query_body=$(echo "$query_response" | sed '$d')
query_status=$(echo "$query_response" | tail -n 1)

if [ "$query_status" -ge 200 ] && [ "$query_status" -lt 300 ]; then
    print_success "Records queried successfully ($query_status)"
    echo "Records: $query_body" | head -c 500
    echo ""
else
    print_fail "Record query failed ($query_status)"
    echo "Error: $query_body"
fi

print_success "🎉 ID field tests completed!"