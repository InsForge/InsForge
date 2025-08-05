#!/bin/bash

# Test script to trigger various PostgreSQL error codes and see the error messages

# Configuration
API_URL="http://localhost:7130"
API_KEY="your-api-key-here"  # Replace with actual API key

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Testing PostgreSQL Error Messages${NC}"
echo "=================================="

# Function to print test results
print_result() {
    local test_name=$1
    local response=$2
    local error_code=$3
    
    echo -e "\n${GREEN}Test: ${test_name}${NC}"
    echo -e "PostgreSQL Error Code: ${error_code}"
    echo "Response:"
    echo "$response" | jq '.' 2>/dev/null || echo "$response"
    echo "---"
}

# Get auth token first
echo -e "\n${YELLOW}Getting auth token...${NC}"
AUTH_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/v2/admin/sign-in" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-this-password"}')

TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.token // .access_token // empty')

if [ -z "$TOKEN" ]; then
    echo -e "${RED}Failed to get auth token${NC}"
    echo "$AUTH_RESPONSE"
    exit 1
fi

echo -e "${GREEN}Got token successfully${NC}"

# 1. Test 23505 - Unique constraint violation
echo -e "\n${YELLOW}1. Testing Unique Constraint Violation (23505)${NC}"

# Create a test table with unique constraint
curl -s -X POST "$API_URL/api/database/tables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table_name": "test_unique",
    "columns": [
      {"name": "email", "type": "string", "nullable": false, "is_unique": true},
      {"name": "name", "type": "string", "nullable": false, "is_unique": false}
    ]
  }' > /dev/null

# Insert first record
curl -s -X POST "$API_URL/api/database/records/test_unique" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"email": "test@example.com", "name": "Test User"}]' > /dev/null

# Try to insert duplicate - this should trigger 23505
RESPONSE=$(curl -s -X POST "$API_URL/api/database/records/test_unique" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"email": "test@example.com", "name": "Another User"}]')

print_result "Unique Constraint Violation" "$RESPONSE" "23505"

# 2. Test 23503 - Foreign key violation
echo -e "\n${YELLOW}2. Testing Foreign Key Violation (23503)${NC}"

# Create parent table
curl -s -X POST "$API_URL/api/database/tables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table_name": "test_parent",
    "columns": [
      {"name": "name", "type": "string", "nullable": false, "is_unique": false}
    ]
  }' > /dev/null

# Create child table with foreign key
curl -s -X POST "$API_URL/api/database/tables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table_name": "test_child",
    "columns": [
      {"name": "parent_id", "type": "uuid", "nullable": false, "is_unique": false,
       "foreign_key": {
         "reference_table": "test_parent",
         "reference_column": "id",
         "on_delete": "RESTRICT",
         "on_update": "CASCADE"
       }},
      {"name": "name", "type": "string", "nullable": false, "is_unique": false}
    ]
  }' > /dev/null

# Try to insert child with non-existent parent - this should trigger 23503
RESPONSE=$(curl -s -X POST "$API_URL/api/database/records/test_child" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"parent_id": "00000000-0000-0000-0000-000000000000", "name": "Orphan Child"}]')

print_result "Foreign Key Violation" "$RESPONSE" "23503"

# 3. Test 23502 - Not null violation
echo -e "\n${YELLOW}3. Testing Not Null Violation (23502)${NC}"

# Create table with not null constraint
curl -s -X POST "$API_URL/api/database/tables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table_name": "test_not_null",
    "columns": [
      {"name": "required_field", "type": "string", "nullable": false, "is_unique": false},
      {"name": "optional_field", "type": "string", "nullable": true, "is_unique": false}
    ]
  }' > /dev/null

# Try to insert without required field - this should trigger 23502
RESPONSE=$(curl -s -X POST "$API_URL/api/database/records/test_not_null" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"optional_field": "only optional"}]')

print_result "Not Null Violation" "$RESPONSE" "23502"

# 4. Test 42P01 - Undefined table
echo -e "\n${YELLOW}4. Testing Undefined Table (42P01)${NC}"

# Try to query non-existent table - this should trigger 42P01
RESPONSE=$(curl -s -X GET "$API_URL/api/database/records/non_existent_table" \
  -H "Authorization: Bearer $TOKEN")

print_result "Undefined Table" "$RESPONSE" "42P01"

# 5. Test 42701 - Duplicate column
echo -e "\n${YELLOW}5. Testing Duplicate Column (42701)${NC}"

# Try to create table with duplicate columns - this should trigger 42701
RESPONSE=$(curl -s -X POST "$API_URL/api/database/tables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table_name": "test_duplicate_column",
    "columns": [
      {"name": "email", "type": "string", "nullable": false, "is_unique": false},
      {"name": "email", "type": "string", "nullable": true, "is_unique": false}
    ]
  }')

print_result "Duplicate Column" "$RESPONSE" "42701"

# 6. Test 42703 - Undefined column
echo -e "\n${YELLOW}6. Testing Undefined Column (42703)${NC}"

# Create a simple table
curl -s -X POST "$API_URL/api/database/tables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table_name": "test_column_ref",
    "columns": [
      {"name": "name", "type": "string", "nullable": false, "is_unique": false}
    ]
  }' > /dev/null

# Try to query with non-existent column - this should trigger 42703
RESPONSE=$(curl -s -X GET "$API_URL/api/database/records/test_column_ref?non_existent_column=eq.test" \
  -H "Authorization: Bearer $TOKEN")

print_result "Undefined Column" "$RESPONSE" "42703"

# 7. Test 42830 - Invalid foreign key
echo -e "\n${YELLOW}7. Testing Invalid Foreign Key (42830)${NC}"

# Create table without unique constraint
curl -s -X POST "$API_URL/api/database/tables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table_name": "test_non_unique",
    "columns": [
      {"name": "code", "type": "string", "nullable": false, "is_unique": false}
    ]
  }' > /dev/null

# Try to create foreign key to non-unique column - this should trigger 42830
RESPONSE=$(curl -s -X POST "$API_URL/api/database/tables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table_name": "test_invalid_fk",
    "columns": [
      {"name": "ref_code", "type": "string", "nullable": false, "is_unique": false,
       "foreign_key": {
         "reference_table": "test_non_unique",
         "reference_column": "code",
         "on_delete": "CASCADE",
         "on_update": "CASCADE"
       }}
    ]
  }')

print_result "Invalid Foreign Key" "$RESPONSE" "42830"

# 8. Test 42804 - Datatype mismatch
echo -e "\n${YELLOW}8. Testing Datatype Mismatch (42804)${NC}"

# Create parent table with integer column
curl -s -X POST "$API_URL/api/database/tables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table_name": "test_int_parent",
    "columns": [
      {"name": "code", "type": "integer", "nullable": false, "is_unique": true}
    ]
  }' > /dev/null

# Try to create foreign key with mismatched type - this should trigger 42804
RESPONSE=$(curl -s -X POST "$API_URL/api/database/tables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "table_name": "test_type_mismatch",
    "columns": [
      {"name": "ref_code", "type": "string", "nullable": false, "is_unique": false,
       "foreign_key": {
         "reference_table": "test_int_parent",
         "reference_column": "code",
         "on_delete": "CASCADE",
         "on_update": "CASCADE"
       }}
    ]
  }')

print_result "Datatype Mismatch" "$RESPONSE" "42804"

# Cleanup
echo -e "\n${YELLOW}Cleaning up test tables...${NC}"
for table in test_unique test_child test_parent test_not_null test_duplicate_column test_column_ref test_non_unique test_invalid_fk test_int_parent test_type_mismatch; do
    curl -s -X DELETE "$API_URL/api/database/tables/$table" \
      -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
done

echo -e "\n${GREEN}Testing complete!${NC}"