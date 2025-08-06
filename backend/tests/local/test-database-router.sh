#!/bin/bash

# Simple database router test script

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Source the test configuration
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing database router..."

# Configuration
API_BASE="$TEST_API_BASE"
TEST_EMAIL="$TEST_ADMIN_EMAIL"
TEST_PASSWORD="$TEST_ADMIN_PASSWORD"
AUTH_TOKEN=""

# Dynamic table name to avoid conflicts
TEST_TABLE="test_products_$(date +%s)"

# Register table for cleanup
register_test_table "$TEST_TABLE"

# Test function
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    
    echo -e "${YELLOW}Test: $description${NC}"
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" -X GET "$endpoint" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -H "Content-Type: application/json")
    elif [ "$method" = "POST" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$endpoint" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$data")
    fi
    
    # Separate response body and status code
    body=$(echo "$response" | sed '$d')
    status=$(echo "$response" | tail -n 1)
    
    if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
        print_success "Success ($status)"
        echo "Response: $body" | head -c 200
        echo ""
    else
        print_fail "Failed ($status)"
        echo "Error: $body"
    fi
    echo ""
}

# 1. Login to get token
echo "🔑 Logging in to get authentication token..."
AUTH_TOKEN=$(get_admin_token)

if [ -n "$AUTH_TOKEN" ]; then
    print_success "Login successful"
else
    print_fail "Login failed"
    echo "Please ensure the service is running and admin account exists"
fi

# Get API key for database operations
API_KEY=""
if [ -n "$AUTH_TOKEN" ]; then
    api_key_response=$(curl -s "$API_BASE/metadata/api-key" \
        -H "Authorization: Bearer $AUTH_TOKEN")
    if echo "$api_key_response" | grep -q '"apiKey"'; then
        API_KEY=$(echo "$api_key_response" | grep -o '"apiKey":"[^"]*"' | cut -d'"' -f4)
        print_success "API key obtained"
    else
        print_fail "Failed to get API key"
    fi
fi

# 2. Create test table
echo "📋 Creating test table($TEST_TABLE)..."
create_table_response=$(curl -s -X POST "$API_BASE/database/tables" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "tableName": "'$TEST_TABLE'",
        "rlsEnabled": false,
        "columns":[
  {
    "columnName": "name",
    "type": "string",
    "isNullable": true,
    "isUnique": false
  },
  {
    "columnName": "price",
    "type": "float",
    "isNullable": true,
    "isUnique": false
  },
  {
    "columnName": "category",
    "type": "string",
    "isNullable": true,
    "isUnique": false
  }
] 
    }')

if ! echo "$create_table_response" | grep -q '"error"'; then
    echo -e "${GREEN}✅ Test table created successfully${NC}"
else
    echo -e "${RED}❌ Test table creation failed${NC}"
    echo "Response: $create_table_response"
fi

# 3. Test database router
print_info "🗄️ Testing database router..."

# Wait for the table to be created and synced
sleep 3

# Insert data
test_endpoint "POST" "$API_BASE/database/records/$TEST_TABLE" \
    '{"name":"iPhone 15","price":999.99,"category":"Electronics"}' \
    "Insert product data"

# Query data
test_endpoint "GET" "$API_BASE/database/records/$TEST_TABLE" \
    "" \
    "Query all products"

# Conditional query
test_endpoint "GET" "$API_BASE/database/records/$TEST_TABLE?category=eq.Electronics" \
    "" \
    "Query products by category"

# Select fields
test_endpoint "GET" "$API_BASE/database/records/$TEST_TABLE?select=name,price" \
    "" \
    "Select specific fields"

# Pagination query
test_endpoint "GET" "$API_BASE/database/records/$TEST_TABLE?limit=1&offset=0" \
    "" \
    "Pagination query"

echo -e "${GREEN}🎉 Database router test completed!${NC}"
echo ""
echo "📚 For more tests, see:"
echo "   - examples/database-router-example.js"
echo "   - docs/database-router.md" 
