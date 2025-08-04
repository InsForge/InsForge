#!/bin/bash

# Test Traditional REST Response Format
# This script tests various API endpoints to ensure they follow traditional REST conventions

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Source the test configuration
source "$SCRIPT_DIR/../test-config.sh"

# Check requirements
check_requirements

print_blue "🧪 Testing Traditional REST Response Format..."

# API Configuration
API_BASE="$TEST_API_BASE"
TEST_USER_EMAIL="testuser_rest_$(date +%s)@example.com"
TEST_USER_PASSWORD="TestPass123!"
AUTH_TOKEN=""

# Function to test response format
test_response_format() {
    local test_name="$1"
    local response="$2"
    local expected_pattern="$3"
    local should_not_exist="${4:-false}"
    
    if [ "$should_not_exist" == "true" ]; then
        # Check that pattern does NOT exist
        if ! echo "$response" | grep -q "$expected_pattern"; then
            print_success "$test_name"
            return 0
        else
            print_fail "$test_name - found unwanted pattern: $expected_pattern"
            track_test_failure
            return 1
        fi
    else
        # Check that pattern exists
        if echo "$response" | grep -q "$expected_pattern"; then
            print_success "$test_name"
            return 0
        else
            print_fail "$test_name - missing pattern: $expected_pattern"
            echo "  Response: $(echo "$response" | head -c 200)..."
            track_test_failure
            return 1
        fi
    fi
}

# 1. Test Health Endpoint
print_info "1. Testing Health Endpoint (Success Response)"
response=$(curl -s "$API_BASE/health")
test_response_format "Direct data response" "$response" '"status":"ok"'
test_response_format "No success wrapper" "$response" '"success":true' "true"
test_response_format "No data wrapper" "$response" '"data":{' "true"

# 2. Test Authentication Errors
print_info "2. Testing Authentication Errors"
response=$(curl -s "$API_BASE/auth/me")
test_response_format "Error format" "$response" '"error":"AUTH_INVALID_CREDENTIALS"'
test_response_format "Message field" "$response" '"message":"No token provided"'
test_response_format "Status code field" "$response" '"statusCode":401'
test_response_format "NextAction field" "$response" '"nextAction":"'

# 3. Test Login Endpoint (Missing Credentials)
print_info "3. Testing Login Endpoint (Missing Credentials)"
response=$(curl -s -X POST "$API_BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d '{}')
test_response_format "Error response" "$response" '"error":"MISSING_FIELD"'
test_response_format "400 status" "$response" '"statusCode":400'

# 4. Test Invalid Endpoint (404)
print_info "4. Testing Invalid Endpoint (404)"
response=$(curl -s "$API_BASE/nonexistent")
test_response_format "404 error" "$response" '"statusCode":404'
test_response_format "Not found message" "$response" '"error":"NOT_FOUND"'

# 5. Test with Authentication
print_info "5. Creating test user for authenticated tests"
auth_response=$(curl -s -X POST "$API_BASE/auth/register" \
    -H "Content-Type: application/json" \
    -d "{
        \"email\": \"$TEST_USER_EMAIL\",
        \"password\": \"$TEST_USER_PASSWORD\",
        \"name\": \"Test User\"
    }")

# Check if registration was successful
if echo "$auth_response" | grep -q '"access_token"'; then
    AUTH_TOKEN=$(echo "$auth_response" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)
    print_success "User registered successfully"
    register_test_user "$TEST_USER_EMAIL"
    
    # Test authenticated endpoints
    print_info "6. Testing Database Tables List (Authenticated)"
    response=$(curl -s "$API_BASE/database/tables" \
        -H "Authorization: Bearer $AUTH_TOKEN")
    test_response_format "Direct array response" "$response" '^\['
    test_response_format "No wrapper object" "$response" '"data":\[' "true"
    
    # Test table creation
    print_info "7. Testing Create Table (Success Response)"
    TABLE_NAME="test_rest_table_$(date +%s)"
    response=$(curl -s -X POST "$API_BASE/database/tables" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"table_name\": \"$TABLE_NAME\",
            \"rls_enabled\": false,
            \"columns\": [
                {\"name\": \"id\", \"type\": \"uuid\", \"nullable\": false, \"is_unique\": false, \"default_value\": \"gen_random_uuid()\"},
                {\"name\": \"title\", \"type\": \"string\", \"nullable\": false, \"is_unique\": false}
            ]
        }")
    
    if echo "$response" | grep -q '"table_name"'; then
        print_success "Table created"
        register_test_table "$TABLE_NAME"
        test_response_format "Direct object response" "$response" "\"table_name\":\"$TABLE_NAME\""
        test_response_format "No success wrapper" "$response" '"success":true' "true"
    else
        print_fail "Table creation failed"
        echo "Response: $response"
        track_test_failure
    fi
    
    # Test pagination headers
    print_info "8. Testing Pagination Headers"
    # Use -I for headers, but we need both headers and body
    full_response=$(curl -s -i "$API_BASE/logs?limit=10" \
        -H "Authorization: Bearer $AUTH_TOKEN")
    
    # Extract headers (everything before empty line)
    headers=$(echo "$full_response" | awk 'BEGIN{RS="\r\n\r\n"} NR==1')
    
    test_response_format "X-Total-Count header" "$headers" 'X-Total-Count:'
    test_response_format "X-Page header" "$headers" 'X-Page:'
    test_response_format "X-Limit header" "$headers" 'X-Limit:'
    
else
    print_fail "Failed to register user"
    echo "Response: $auth_response"
    track_test_failure
fi

# 9. Test Storage API (requires API key)
print_info "9. Testing Storage API Format"
API_KEY=$(get_admin_api_key)
if [ -n "$API_KEY" ]; then
    # List buckets
    response=$(curl -s "$API_BASE/storage/buckets" \
        -H "x-api-key: $API_KEY")
    test_response_format "Direct array for buckets" "$response" '^\['
    
    # Create a test bucket
    BUCKET_NAME="test-rest-bucket-$(date +%s)"
    response=$(curl -s -X POST "$API_BASE/storage/buckets" \
        -H "Content-Type: application/json" \
        -H "x-api-key: $API_KEY" \
        -d "{\"bucket\": \"$BUCKET_NAME\", \"public\": true}")
    
    if echo "$response" | grep -q '"bucket"'; then
        print_success "Bucket created"
        register_test_bucket "$BUCKET_NAME"
        test_response_format "Success message field" "$response" '"message":"Bucket created successfully"'
        test_response_format "NextAction guidance" "$response" '"nextAction":'
    else
        print_fail "Bucket creation failed"
        echo "Response: $response"
        track_test_failure
    fi
else
    print_info "Skipping storage tests (no API key available)"
fi

# Summary
echo ""
print_blue "=========================================="
print_blue "Traditional REST Format Test Complete"
print_blue "=========================================="

# Exit with proper status
exit_with_status