#!/bin/bash

# AI Configuration test script

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing AI configuration..."

API_BASE="$TEST_API_BASE"
ADMIN_TOKEN=""
CONFIG_ID=""
TEST_MODEL_ID="test-gpt-3.5-turbo"  # Use consistent test model ID - cleanup will remove it

# Get admin token
echo "🔑 Getting admin token..."
ADMIN_TOKEN=$(get_admin_token)

if [ -z "$ADMIN_TOKEN" ]; then
    print_fail "Failed to get admin token"
    exit 1
fi
print_success "Got admin token"
echo ""

# 1. Create AI configuration with unique test model ID
echo "📝 Creating AI configuration (model: $TEST_MODEL_ID)..."
create_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/configurations" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"inputModality\": [\"text\"],
        \"outputModality\": [\"text\"],
        \"provider\": \"openai\",
        \"modelId\": \"$TEST_MODEL_ID\",
        \"systemPrompt\": \"You are a helpful assistant.\"
    }")

status=$(echo "$create_response" | tail -n 1)
body=$(echo "$create_response" | sed '$d')

if [ "$status" -eq 201 ]; then
    print_success "AI configuration created"
    CONFIG_ID=$(echo "$body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    echo "Config ID: $CONFIG_ID"
    # Register for cleanup even if tests fail later
    if [ -n "$CONFIG_ID" ]; then
        register_test_ai_config "$CONFIG_ID"
    fi
else
    print_fail "Failed to create AI configuration (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 2. List all configurations
echo "📋 Listing all AI configurations..."
list_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/ai/configurations" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$list_response" | tail -n 1)
body=$(echo "$list_response" | sed '$d')

if [ "$status" -eq 200 ] && echo "$body" | grep -q "$CONFIG_ID"; then
    print_success "Listed configurations successfully"
else
    print_fail "Failed to list configurations (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 3. Update configuration
echo "✏️ Updating AI configuration..."
update_response=$(curl -s -w "\n%{http_code}" -X PATCH "$API_BASE/ai/configurations/$CONFIG_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "systemPrompt": "You are an expert coding assistant."
    }')

status=$(echo "$update_response" | tail -n 1)
body=$(echo "$update_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "AI configuration updated"
else
    print_fail "Failed to update configuration (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 4. Get models list
echo "🤖 Getting available models..."
models_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/ai/models" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$models_response" | tail -n 1)
body=$(echo "$models_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Retrieved models list"
else
    print_fail "Failed to get models (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 5. Delete configuration
echo "🗑️ Deleting AI configuration..."
delete_response=$(curl -s -w "\n%{http_code}" -X DELETE "$API_BASE/ai/configurations/$CONFIG_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN")

status=$(echo "$delete_response" | tail -n 1)
body=$(echo "$delete_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "AI configuration deleted"
else
    print_fail "Failed to delete configuration (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

print_success "🎉 AI configuration test completed!"
