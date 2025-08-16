#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Source the test configuration
source "$SCRIPT_DIR/../test-config.sh"

# Configuration
API_BASE_URL="$TEST_API_BASE"
PUBLIC_BUCKET="public-images-$(date +%s)"
PRIVATE_BUCKET="private-docs-$(date +%s)"
TEST_FILE="test.txt"

# Register buckets for cleanup
register_test_bucket "$PUBLIC_BUCKET"
register_test_bucket "$PRIVATE_BUCKET"

echo "🧪 Testing Public/Private Bucket Functionality"
echo "============================================="

# Get admin token for auth endpoints
admin_token=$(get_admin_token)
if [ -z "$admin_token" ]; then
    print_fail "Could not get admin token"
else
    print_success "Admin authentication successful"
fi

# Get API key for storage operations
api_key=$(get_admin_api_key)

# If that fails, try to get it via the API endpoint
if [ -z "$api_key" ] && [ -n "$admin_token" ]; then
    api_key_response=$(curl -s "$TEST_API_BASE/metadata/api-key" \
        -H "Authorization: Bearer $admin_token")
    api_key=$(echo "$api_key_response" | grep -o '"apiKey":"[^"]*' | cut -d'"' -f4)
fi

# Export for cleanup
if [ -n "$api_key" ]; then
    export ACCESS_API_KEY="$api_key"
    print_success "API key obtained for storage operations"
else
    print_fail "Could not get API key for storage operations"
fi

# Step 1: Create a public bucket
print_info "1️⃣  Creating PUBLIC bucket: $PUBLIC_BUCKET"
response=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE_URL}/storage/buckets" \
  -H "x-api-key: ${api_key}" \
  -H "Content-Type: application/json" \
  -d "{\"bucketName\": \"${PUBLIC_BUCKET}\", \"isPublic\": true}")

body=$(echo "$response" | sed '$d')
status=$(echo "$response" | tail -n 1)

if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    print_success "Public bucket created ($status)"
    # Pretty print JSON if available
    if command -v jq &> /dev/null && echo "$body" | jq . >/dev/null 2>&1; then
        echo "$body" | jq '.'
    else
        echo "Response: $body"
    fi
else
    print_fail "Public bucket creation failed ($status)"
    echo "Error: $body"
fi

# Step 2: Create a private bucket
print_info "2️⃣  Creating PRIVATE bucket: $PRIVATE_BUCKET"
response=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE_URL}/storage/buckets" \
  -H "x-api-key: ${api_key}" \
  -H "Content-Type: application/json" \
  -d "{\"bucketName\": \"${PRIVATE_BUCKET}\", \"isPublic\": false}")

body=$(echo "$response" | sed '$d')
status=$(echo "$response" | tail -n 1)

if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    print_success "Private bucket created ($status)"
    if command -v jq &> /dev/null && echo "$body" | jq . >/dev/null 2>&1; then
        echo "$body" | jq '.'
    else
        echo "Response: $body"
    fi
else
    print_fail "Private bucket creation failed ($status)"
    echo "Error: $body"
fi

# Step 3: Upload a test file to public bucket
print_info "3️⃣  Uploading file to PUBLIC bucket..."
# First delete if exists
curl -s -X DELETE "${API_BASE_URL}/storage/buckets/${PUBLIC_BUCKET}/objects/${TEST_FILE}" \
  -H "x-api-key: ${api_key}" > /dev/null 2>&1

echo "This is a test file for public access" > /tmp/public-test.txt
response=$(curl -s -w "\n%{http_code}" -X PUT "${API_BASE_URL}/storage/buckets/${PUBLIC_BUCKET}/objects/${TEST_FILE}" \
  -H "x-api-key: ${api_key}" \
  -F "file=@/tmp/public-test.txt")

body=$(echo "$response" | sed '$d')
status=$(echo "$response" | tail -n 1)

if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    print_success "File uploaded to public bucket ($status)"
    if command -v jq &> /dev/null && echo "$body" | jq . >/dev/null 2>&1; then
        echo "$body" | jq '.'
    else
        echo "Response: $body"
    fi
else
    print_fail "File upload to public bucket failed ($status)"
    echo "Error: $body"
fi

# Step 4: Upload a test file to private bucket
print_info "4️⃣  Uploading file to PRIVATE bucket..."
# First delete if exists
curl -s -X DELETE "${API_BASE_URL}/storage/buckets/${PRIVATE_BUCKET}/objects/${TEST_FILE}" \
  -H "x-api-key: ${api_key}" > /dev/null 2>&1

echo "This is a test file for private access" > /tmp/private-test.txt
response=$(curl -s -w "\n%{http_code}" -X PUT "${API_BASE_URL}/storage/buckets/${PRIVATE_BUCKET}/objects/${TEST_FILE}" \
  -H "x-api-key: ${api_key}" \
  -F "file=@/tmp/private-test.txt")

body=$(echo "$response" | sed '$d')
status=$(echo "$response" | tail -n 1)

if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    print_success "File uploaded to private bucket ($status)"
    if command -v jq &> /dev/null && echo "$body" | jq . >/dev/null 2>&1; then
        echo "$body" | jq '.'
    else
        echo "Response: $body"
    fi
else
    print_fail "File upload to private bucket failed ($status)"
    echo "Error: $body"
fi

# Step 5: Test accessing PUBLIC file WITHOUT API key
print_info "5️⃣  Testing PUBLIC file access WITHOUT API key..."
echo "   Accessing: ${API_BASE_URL}/storage/buckets/${PUBLIC_BUCKET}/objects/${TEST_FILE}"
HTTP_CODE=$(curl -s -o /tmp/public-response.txt -w "%{http_code}" "${API_BASE_URL}/storage/buckets/${PUBLIC_BUCKET}/objects/${TEST_FILE}")
if [ "$HTTP_CODE" -eq 200 ]; then
    print_success "Public file accessible without API key! (Status: ${HTTP_CODE})"
    echo "   📄 Content: $(cat /tmp/public-response.txt)"
else
    print_fail "Public file NOT accessible without API key (Status: ${HTTP_CODE})"
fi

# Step 6: Test accessing PRIVATE file WITHOUT API key
print_info "6️⃣  Testing PRIVATE file access WITHOUT API key..."
echo "   Accessing: ${API_BASE_URL}/storage/buckets/${PRIVATE_BUCKET}/objects/${TEST_FILE}"
HTTP_CODE=$(curl -s -o /tmp/private-response.txt -w "%{http_code}" "${API_BASE_URL}/storage/buckets/${PRIVATE_BUCKET}/objects/${TEST_FILE}")
if [ "$HTTP_CODE" -eq 401 ]; then
    print_success "Private file correctly blocked without API key! (Status: ${HTTP_CODE})"
else
    print_fail "Private file should NOT be accessible without API key (Status: ${HTTP_CODE})"
fi

# Step 7: Test accessing PRIVATE file WITH API key
print_info "7️⃣  Testing PRIVATE file access WITH API key..."
HTTP_CODE=$(curl -s -o /tmp/private-auth-response.txt -w "%{http_code}" \
  -H "x-api-key: ${api_key}" \
  "${API_BASE_URL}/storage/buckets/${PRIVATE_BUCKET}/objects/${TEST_FILE}")
if [ "$HTTP_CODE" -eq 200 ]; then
    print_success "Private file accessible with API key! (Status: ${HTTP_CODE})"
    echo "   📄 Content: $(cat /tmp/private-auth-response.txt)"
else
    print_fail "Private file should be accessible with API key (Status: ${HTTP_CODE})"
fi

# Step 8: List all buckets
print_info "8️⃣  Listing all buckets..."
response=$(curl -s -w "\n%{http_code}" -H "x-api-key: ${api_key}" "${API_BASE_URL}/storage/buckets")
body=$(echo "$response" | sed '$d')
status=$(echo "$response" | tail -n 1)

if [ "$status" -eq 200 ]; then
    print_success "Buckets listed successfully"
    if command -v jq &> /dev/null && echo "$body" | jq . >/dev/null 2>&1; then
        echo "$body" | jq '.[] | "\(.name) - \(if .public then "🌍 PUBLIC" else "🔒 PRIVATE" end)"' -r 2>/dev/null || echo "Could not parse bucket list"
    else
        echo "Response: $body"
    fi
else
    print_fail "Failed to list buckets ($status)"
    echo "Error: $body"
fi

# Step 9: Test POST upload with auto-generated key
print_info "9️⃣  Testing POST upload with auto-generated key..."
echo "This is a test file for POST upload" > /tmp/post-test.txt
response=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE_URL}/storage/buckets/${PUBLIC_BUCKET}/objects" \
  -H "x-api-key: ${api_key}" \
  -F "file=@/tmp/post-test.txt")

body=$(echo "$response" | sed '$d')
status=$(echo "$response" | tail -n 1)

if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    print_success "File uploaded via POST with auto-generated key ($status)"
    if command -v jq &> /dev/null && echo "$body" | jq . >/dev/null 2>&1; then
        echo "$body" | jq '.'
        # Extract the generated key for verification
        generated_key=$(echo "$body" | jq -r '.key')
        echo "   📝 Generated key: $generated_key"
        # Test downloading the file with generated key
        HTTP_CODE=$(curl -s -o /tmp/post-download.txt -w "%{http_code}" "${API_BASE_URL}/storage/buckets/${PUBLIC_BUCKET}/objects/${generated_key}")
        if [ "$HTTP_CODE" -eq 200 ]; then
            print_success "Downloaded file with generated key!"
            echo "   📄 Content: $(cat /tmp/post-download.txt)"
        else
            print_fail "Could not download file with generated key (Status: ${HTTP_CODE})"
        fi
    else
        echo "Response: $body"
    fi
else
    print_fail "POST upload failed ($status)"
    echo "Error: $body"
fi

# Step 10: Update bucket visibility
print_info "🔟 Testing bucket visibility update (making public bucket private)..."
response=$(curl -s -w "\n%{http_code}" -X PATCH "${API_BASE_URL}/storage/buckets/${PUBLIC_BUCKET}" \
  -H "x-api-key: ${api_key}" \
  -H "Content-Type: application/json" \
  -d '{"isPublic": false}')

body=$(echo "$response" | sed '$d')
status=$(echo "$response" | tail -n 1)

if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    print_success "Bucket visibility updated ($status)"
    if command -v jq &> /dev/null && echo "$body" | jq . >/dev/null 2>&1; then
        echo "$body" | jq '.'
    else
        echo "Response: $body"
    fi
else
    print_fail "Bucket visibility update failed ($status)"
    echo "Error: $body"
fi

# Test access again
echo "   Testing access after update..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE_URL}/storage/buckets/${PUBLIC_BUCKET}/objects/${TEST_FILE}")
if [ "$HTTP_CODE" -eq 401 ]; then
    print_success "Previously public file now requires authentication!"
else
    print_fail "File should now require authentication (Status: ${HTTP_CODE})"
fi

# Cleanup temp files only
print_info "🧹 Cleaning up temp files..."
rm -f /tmp/public-test.txt /tmp/private-test.txt /tmp/public-response.txt /tmp/private-response.txt /tmp/private-auth-response.txt /tmp/post-test.txt /tmp/post-download.txt

print_success "✨ Public/Private bucket test completed!"
# Note: Buckets will be cleaned up automatically on exit via test-config.sh