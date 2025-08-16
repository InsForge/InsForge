#!/bin/bash

# End-to-End test script for Insforge Backend

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Source the test configuration
source "$SCRIPT_DIR/../test-config.sh"

# Test variables
TEST_EMAIL="${TEST_USER_EMAIL_PREFIX}e2e_$(date +%s)@example.com"
TEST_PASSWORD="TestPassword123!"
USER_TOKEN=""
API_KEY=""
USER_ID=""
TEST_TABLE="test_todos_$(date +%s)"
TEST_BUCKET="test-bucket-$(date +%s)"

# Export API_KEY so cleanup can use it
export ACCESS_API_KEY=""

# Register test resources for cleanup
register_test_user "$TEST_EMAIL"
register_test_table "$TEST_TABLE"
register_test_bucket "$TEST_BUCKET"

echo "Starting End-to-End Tests for Insforge Backend"
echo "=================================="

# Function to test endpoint
test_endpoint() {
    local test_name=$1
    local response=$2
    local expected_status=$3
    local actual_status=$(echo "$response" | tail -n 1)
    
    if [ "$actual_status" == "$expected_status" ]; then
        print_success "$test_name"
        return 0
    else
        print_fail "$test_name - Expected $expected_status, got $actual_status"
        echo "Response: $(echo "$response" | sed '$d')"
        return 1
    fi
}

# 1. Test Health Check
print_info "1. Testing Health Check"
response=$(curl -s -w "\n%{http_code}" "$TEST_API_BASE/health")
test_endpoint "Health check" "$response" "200"

# 2. Test User Registration
print_info "2. Testing User Registration"
response_with_code=$(register_user "$TEST_EMAIL" "$TEST_PASSWORD" "Test User" && echo -e "\n201")
test_endpoint "User registration" "$response_with_code" "201"

# Extract token from response
response=$(echo "$response_with_code" | sed '$d')
USER_TOKEN=$(echo "$response" | grep -o '"accessToken":"[^"]*' | grep -o '[^"]*$')
USER_ID=$(echo "$response" | grep -o '"user":{[^}]*' | grep -o '"id":"[^"]*' | grep -o '[^"]*$')

if [ -z "$USER_TOKEN" ]; then
    print_fail "Failed to extract user token"
else
    echo "User ID: $USER_ID"
    echo "Token: ${USER_TOKEN:0:20}..."
fi

# 3. Test User Login
print_info "3. Testing User Login"
response_with_code=$(login_user "$TEST_EMAIL" "$TEST_PASSWORD" && echo -e "\n200")
test_endpoint "User login" "$response_with_code" "200"

# 4. Test Get Profile (with auth)
print_info "4. Testing Get Profile"
response_with_code=$(get_user_profile "$USER_TOKEN" && echo -e "\n200")
test_endpoint "Get profile" "$response_with_code" "200"

# Get admin token for table operations and API key
admin_token=$(get_admin_token)
if [ -z "$admin_token" ]; then
    print_fail "Could not get admin token for table operations"
else
    print_success "Got admin token for table operations"
fi

# 5. Get API Key
print_info "5. Getting API Key"
# First try environment variable or docker logs
API_KEY=$(get_admin_api_key)

# If that fails, try to get it via the API endpoint
if [ -z "$API_KEY" ] && [ -n "$admin_token" ]; then
    api_key_response=$(curl -s "$TEST_API_BASE/metadata/api-key" \
        -H "Authorization: Bearer $admin_token")
    API_KEY=$(echo "$api_key_response" | grep -o '"apiKey":"[^"]*' | cut -d'"' -f4)
fi

if [ -n "$API_KEY" ]; then
    print_success "Got API key"
    echo "API Key: ${API_KEY:0:20}..."
    # Export for cleanup
    export ACCESS_API_KEY="$API_KEY"
else
    print_fail "Failed to get API key - remaining tests will be skipped"
fi

# Continue only if we have an API key
if [ -z "$API_KEY" ]; then
    print_info "Skipping remaining tests - no API key available"
    exit 0
fi

# 6. Test Create Table
print_info "6. Testing Create Table"
response=$(curl -s -w "\n%{http_code}" -X POST "$TEST_API_BASE/database/tables" \
  -H "Authorization: Bearer $admin_token" \
  -H "Content-Type: application/json" \
  -d "{
    \"tableName\": \"$TEST_TABLE\",
    \"rlsEnabled\": false,
    \"columns\": [
      {\"columnName\": \"title\", \"type\": \"string\", \"isNullable\": false, \"isUnique\": false},
      {\"columnName\": \"completed\", \"type\": \"boolean\", \"isNullable\": false, \"isUnique\": false, \"defaultValue\": \"false\"},
      {\"columnName\": \"user_id\", \"type\": \"string\", \"isNullable\": false, \"isUnique\": false}
    ]
  }")
test_endpoint "Create table" "$response" "201"

# Wait a bit for table creation to propagate
sleep 1

# 7. Test Insert Record
print_info "7. Testing Insert Record"
response=$(curl -s -w "\n%{http_code}" -X POST "$TEST_API_BASE/database/records/$TEST_TABLE" \
  -H "Authorization: Bearer $admin_token" \
  -H "Content-Type: application/json" \
  -d "[{
    \"title\": \"Test Todo Item\",
    \"completed\": false,
    \"user_id\": \"$USER_ID\"
  }]")
test_endpoint "Insert record" "$response" "201"

# Extract record ID
# PostgREST returns an empty array on successful insert, so we need to query the table
sleep 1  # Give PostgREST time to sync
query_response=$(curl -s "$TEST_API_BASE/database/records/$TEST_TABLE?limit=1&order=created_at.desc" \
  -H "Authorization: Bearer $admin_token")
RECORD_ID=$(echo "$query_response" | jq -r '.[0].id' 2>/dev/null || echo "")
if [ -z "$RECORD_ID" ] || [ "$RECORD_ID" == "null" ]; then
    # Try alternative parsing
    RECORD_ID=$(echo "$query_response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
fi
echo "Record ID: $RECORD_ID"

# 8. Test Get Records
print_info "8. Testing Get Records"
response=$(curl -s -w "\n%{http_code}" "$TEST_API_BASE/database/records/$TEST_TABLE" \
  -H "Authorization: Bearer $admin_token")
test_endpoint "Get records" "$response" "200"

# 9. Test Update Record
if [ -n "$RECORD_ID" ]; then
    print_info "9. Testing Update Record"
    response=$(curl -s -w "\n%{http_code}" -X PATCH "$TEST_API_BASE/database/records/$TEST_TABLE?id=eq.$RECORD_ID" \
      -H "Authorization: Bearer $admin_token" \
      -H "Content-Type: application/json" \
      -d '{
        "completed": true
      }')
    test_endpoint "Update record" "$response" "204"
else
    print_info "9. Skipping Update Record test - no record ID"
fi

# 10. Test Storage - Create Bucket
print_info "10. Testing Create Storage Bucket"
response=$(curl -s -w "\n%{http_code}" -X POST "$TEST_API_BASE/storage/buckets" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"bucketName\": \"$TEST_BUCKET\",
    \"isPublic\": false
  }")
test_endpoint "Create bucket" "$response" "201"

# 11. Test Upload File
print_info "11. Testing Upload File"
echo "Test file content" > /tmp/test-upload.txt
response=$(curl -s -w "\n%{http_code}" -X PUT "$TEST_API_BASE/storage/buckets/$TEST_BUCKET/objects/test-file.txt" \
  -H "x-api-key: $API_KEY" \
  -F "file=@/tmp/test-upload.txt")
test_endpoint "Upload file" "$response" "201"

# 12. Test Download File
print_info "12. Testing Download File"
response=$(curl -s -w "\n%{http_code}" "$TEST_API_BASE/storage/buckets/$TEST_BUCKET/objects/test-file.txt" \
  -H "x-api-key: $API_KEY" \
  -o /tmp/test-download.txt)
test_endpoint "Download file" "$response" "200"

# Verify file content
if [ -f /tmp/test-download.txt ]; then
    downloaded_content=$(cat /tmp/test-download.txt)
    if [ "$downloaded_content" == "Test file content" ]; then
        print_success "File content verified"
    else
        print_fail "File content mismatch"
    fi
    rm -f /tmp/test-download.txt
else
    print_fail "Downloaded file not found"
fi

# 13. Test Delete Record
if [ -n "$RECORD_ID" ]; then
    print_info "13. Testing Delete Record"
    response=$(curl -s -w "\n%{http_code}" -X DELETE "$TEST_API_BASE/database/records/$TEST_TABLE?id=eq.$RECORD_ID" \
      -H "Authorization: Bearer $admin_token")
    test_endpoint "Delete record" "$response" "204"
else
    print_info "13. Skipping Delete Record test - no record ID"
fi

# 14. Test Delete File
print_info "14. Testing Delete File"
response=$(curl -s -w "\n%{http_code}" -X DELETE "$TEST_API_BASE/storage/buckets/$TEST_BUCKET/objects/test-file.txt" \
  -H "x-api-key: $API_KEY")
test_endpoint "Delete file" "$response" "200"

# Clean up temp files
rm -f /tmp/test-upload.txt

echo ""
echo "=================================="
print_success "End-to-End tests completed!"
echo "=================================="

# Note: All test resources will be cleaned up automatically on exit