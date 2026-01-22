#!/bin/bash

# AI Embeddings test script
# Tests the /api/ai/embeddings endpoint

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing AI Embeddings endpoint..."

API_BASE="$TEST_API_BASE"
ADMIN_TOKEN=""

# Get admin token
echo "🔑 Getting admin token..."
ADMIN_TOKEN=$(get_admin_token)

if [ -z "$ADMIN_TOKEN" ]; then
    print_fail "Failed to get admin token"
    exit 1
fi
print_success "Got admin token"
echo ""

# 1. Test embeddings with single text input
echo "📊 Test 1: Embeddings with single text input..."
single_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/embeddings" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/text-embedding-3-small",
        "input": "Hello, world!"
    }')

status=$(echo "$single_response" | tail -n 1)
body=$(echo "$single_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Embeddings with single text input succeeded"
    # Check response structure
    if echo "$body" | grep -q '"object":"list"'; then
        print_success "Response has correct object type (list)"
    else
        print_fail "Response missing object type"
        track_test_failure
    fi
    if echo "$body" | grep -q '"embedding"'; then
        print_success "Response contains embedding data"
    else
        print_fail "Response missing embedding data"
        track_test_failure
    fi
    if echo "$body" | grep -q '"metadata"'; then
        print_success "Response contains metadata"
    else
        echo "Note: Response missing metadata (optional field)"
    fi
    echo "Response preview: $(echo "$body" | head -c 500)"
    echo ""
else
    print_fail "Embeddings with single text input failed (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 2. Test embeddings with array of text inputs
echo "📊 Test 2: Embeddings with array of text inputs..."
array_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/embeddings" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/text-embedding-3-small",
        "input": ["Hello, world!", "How are you?", "This is a test."]
    }')

status=$(echo "$array_response" | tail -n 1)
body=$(echo "$array_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Embeddings with array of text inputs succeeded"
    # Check that we got multiple embeddings
    embedding_count=$(echo "$body" | grep -o '"object":"embedding"' | wc -l | tr -d ' ')
    if [ "$embedding_count" -eq 3 ]; then
        print_success "Response contains 3 embeddings as expected"
    else
        print_fail "Expected 3 embeddings, got $embedding_count"
        track_test_failure
    fi
    echo "Response preview: $(echo "$body" | head -c 500)"
    echo ""
else
    print_fail "Embeddings with array of text inputs failed (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 3. Test embeddings with different model
echo "📊 Test 3: Embeddings with text-embedding-3-large model..."
large_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/embeddings" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/text-embedding-3-large",
        "input": "Testing with larger embedding model"
    }')

status=$(echo "$large_response" | tail -n 1)
body=$(echo "$large_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Embeddings with text-embedding-3-large succeeded"
    echo "Response preview: $(echo "$body" | head -c 500)"
    echo ""
else
    print_fail "Embeddings with text-embedding-3-large failed (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 4. Test embeddings with base64 encoding format
echo "📊 Test 4: Embeddings with base64 encoding format..."
base64_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/embeddings" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/text-embedding-3-small",
        "input": "Testing base64 encoding format",
        "encoding_format": "base64"
    }')

status=$(echo "$base64_response" | tail -n 1)
body=$(echo "$base64_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Embeddings with base64 encoding format succeeded"
    echo "Response preview: $(echo "$body" | head -c 500)"
    echo ""
else
    print_fail "Embeddings with base64 encoding format failed (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 5. Test embeddings validation error (missing model)
echo "📊 Test 5: Validation error - missing model..."
validation_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/embeddings" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "input": "This should fail"
    }')

status=$(echo "$validation_response" | tail -n 1)
body=$(echo "$validation_response" | sed '$d')

if [ "$status" -eq 400 ]; then
    print_success "Validation error returned 400 as expected"
    if echo "$body" | grep -q "Validation error"; then
        print_success "Response contains validation error message"
    fi
    echo "Response: $body"
else
    print_fail "Expected 400 status for validation error, got $status"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 6. Test embeddings validation error (missing input)
echo "📊 Test 6: Validation error - missing input..."
validation_response2=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/embeddings" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/text-embedding-3-small"
    }')

status=$(echo "$validation_response2" | tail -n 1)
body=$(echo "$validation_response2" | sed '$d')

if [ "$status" -eq 400 ]; then
    print_success "Validation error returned 400 as expected"
    if echo "$body" | grep -q "Validation error"; then
        print_success "Response contains validation error message"
    fi
    echo "Response: $body"
else
    print_fail "Expected 400 status for validation error, got $status"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 7. Test embeddings without authentication
echo "📊 Test 7: Request without authentication..."
noauth_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/embeddings" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/text-embedding-3-small",
        "input": "This should fail"
    }')

status=$(echo "$noauth_response" | tail -n 1)
body=$(echo "$noauth_response" | sed '$d')

if [ "$status" -eq 401 ]; then
    print_success "Request without auth returned 401 as expected"
else
    print_fail "Expected 401 status for unauthenticated request, got $status"
    echo "Response: $body"
    track_test_failure
fi
echo ""

print_success "🎉 AI Embeddings test completed!"
