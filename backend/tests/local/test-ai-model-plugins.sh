#!/bin/bash

# AI Web Search and Thinking mode test script
# Tests the new webSearch and thinking parameters for chat completion

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing AI Web Search and Thinking features..."

API_BASE="$TEST_API_BASE"
ADMIN_TOKEN="ik_0322f7447cd878f2e419dc8900fe3e5e"

# Get admin token
echo "🔑 Getting admin token..."
# ADMIN_TOKEN=$(get_admin_token)

# if [ -z "$ADMIN_TOKEN" ]; then
#     print_fail "Failed to get admin token"
#     exit 1
# fi
# print_success "Got admin token"
# echo ""

# 1. Test chat completion with Web Search
echo "🔍 Test 1: Chat completion with Web Search..."
websearch_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/chat/completion" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/gpt-4o",
        "messages": [{"role": "user", "content": "What are the latest AI news today?"}],
        "webSearch": {
            "enabled": true,
            "maxResults": 3
        }
    }')

status=$(echo "$websearch_response" | tail -n 1)
body=$(echo "$websearch_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Chat completion with Web Search succeeded"
    # Check if annotations are present in the response
    if echo "$body" | grep -q "annotations"; then
        print_success "Response contains URL citations (annotations)"
    else
        echo "Note: No annotations in response (may depend on model/query)"
    fi
    echo "Response preview: $(echo "$body" | head -c 500)"
    echo ""
else
    print_fail "Chat completion with Web Search failed (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 2. Test chat completion with Web Search using Exa engine
echo "🔍 Test 2: Chat completion with Web Search (Exa engine)..."
exa_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/chat/completion" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/gpt-4o",
        "messages": [{"role": "user", "content": "What is the current weather in Tokyo?"}],
        "webSearch": {
            "enabled": true,
            "engine": "exa",
            "maxResults": 2
        }
    }')

status=$(echo "$exa_response" | tail -n 1)
body=$(echo "$exa_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Chat completion with Exa Web Search succeeded"
    echo "Response preview: $(echo "$body" | head -c 500)"
    echo ""
else
    print_fail "Chat completion with Exa Web Search failed (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 3. Test chat completion with Thinking mode
echo "🧠 Test 3: Chat completion with Thinking mode..."
thinking_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/chat/completion" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "anthropic/claude-3.7-sonnet:thinking",
        "messages": [{"role": "user", "content": "What is 15 + 27?"}]
    }')

status=$(echo "$thinking_response" | tail -n 1)
body=$(echo "$thinking_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Chat completion with Thinking mode succeeded"
    echo "Response preview: $(echo "$body" | head -c 500)"
    echo ""
else
    print_fail "Chat completion with Thinking mode failed (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 4. Test chat completion with both Web Search and Thinking
echo "🔍🧠 Test 4: Chat completion with Web Search + Thinking..."
combined_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/chat/completion" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "anthropic/claude-3.7-sonnet",
        "messages": [{"role": "user", "content": "What are the recent developments in AI?"}],
        "webSearch": {
            "enabled": true,
            "engine": "native",
            "maxResults": 3
        },
        "thinking": true
    }')

status=$(echo "$combined_response" | tail -n 1)
body=$(echo "$combined_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Chat completion with Web Search + Thinking succeeded"
    echo "Response preview: $(echo "$body" | head -c 500)"
    echo ""
else
    print_fail "Chat completion with Web Search + Thinking failed (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 5. Test streaming with Web Search
echo "📡 Test 5: Streaming chat with Web Search..."
echo "Streaming response (first 20 events):"
stream_output=$(curl -s -N -X POST "$API_BASE/ai/chat/completion" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/gpt-4o",
        "messages": [{"role": "user", "content": "Latest tech news in one sentence"}],
        "stream": true,
        "webSearch": {
            "enabled": true,
            "maxResults": 2
        }
    }' 2>&1 | head -20)

echo "$stream_output"

if echo "$stream_output" | grep -q "data:"; then
    print_success "Streaming with Web Search returned SSE events"
else
    print_fail "Streaming with Web Search did not return expected SSE format"
    track_test_failure
fi
echo ""

# 6. Test streaming with Thinking mode
echo "📡 Test 6: Streaming chat with Thinking mode..."
echo "Streaming response (first 20 events):"
thinking_stream=$(curl -s -N -X POST "$API_BASE/ai/chat/completion" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "anthropic/claude-3.7-sonnet",
        "messages": [{"role": "user", "content": "What is 2+2?"}],
        "stream": true,
        "thinking": true
    }' 2>&1 | head -20)

echo "$thinking_stream"

if echo "$thinking_stream" | grep -q "data:"; then
    print_success "Streaming with Thinking mode returned SSE events"
else
    print_fail "Streaming with Thinking mode did not return expected SSE format"
    track_test_failure
fi
echo ""

# 7. Test Web Search with custom search prompt
echo "🔍 Test 7: Web Search with custom search prompt..."
custom_prompt_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/chat/completion" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/gpt-4o",
        "messages": [{"role": "user", "content": "Tell me about SpaceX launches"}],
        "webSearch": {
            "enabled": true,
            "maxResults": 3,
            "searchPrompt": "Here are some relevant web search results about SpaceX:"
        }
    }')

status=$(echo "$custom_prompt_response" | tail -n 1)
body=$(echo "$custom_prompt_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "Web Search with custom prompt succeeded"
    echo "Response preview: $(echo "$body" | head -c 500)"
    echo ""
else
    print_fail "Web Search with custom prompt failed (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

# 8. Test PDF file processing with file-parser plugin
# Note: Using pdf-text engine (free) instead of native, as native requires models with built-in PDF support
# For URL-based PDFs, OpenRouter's file-parser plugin will fetch and parse the PDF
echo "📄 Test 8: PDF file processing with file-parser plugin..."
pdf_response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/ai/chat/completion" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "openai/gpt-4o",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "Please summarize the content of this PDF document."},
                {"type": "file", "file": {"filename": "sample.pdf", "file_data": "https://pdfco-test-files.s3.us-west-2.amazonaws.com/pdf-to-csv/sample.pdf"}}
            ]
        }],
        "fileParser": {
            "enabled": true,
            "pdf": {
                "engine": "pdf-text"
            }
        }
    }')

status=$(echo "$pdf_response" | tail -n 1)
body=$(echo "$pdf_response" | sed '$d')

if [ "$status" -eq 200 ]; then
    print_success "PDF file processing succeeded"
    echo "Response preview: $(echo "$body" | head -c 800)"
    echo ""
else
    print_fail "PDF file processing failed (status: $status)"
    echo "Response: $body"
    track_test_failure
fi
echo ""

print_success "🎉 AI Web Search and Thinking test completed!"
