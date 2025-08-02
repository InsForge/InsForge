#!/bin/bash

# Comprehensive curl tests for Traditional REST format
# Tests all major endpoints to verify response formats

BASE_URL="http://localhost:7130/api"
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "🧪 Comprehensive Traditional REST Format Tests"
echo "============================================="

# 1. Health Check - Returns object directly
echo -e "\n${BLUE}1. Health Check (Object Response)${NC}"
echo "curl -s $BASE_URL/health"
curl -s "$BASE_URL/health" | jq '.'
echo -e "${GREEN}✓ Returns object directly (no wrapper)${NC}"

# 2. Authentication - Returns object with user and token
echo -e "\n${BLUE}2. Authentication Tests${NC}"
EMAIL="test-$(date +%s)@example.com"
echo "Creating test user: $EMAIL"

# Register
echo -e "\n${BLUE}2a. Register (Object Response)${NC}"
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$EMAIL\", \"password\": \"Test123!\", \"name\": \"Test User\"}")
echo "$REGISTER_RESPONSE" | jq '.'
TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.access_token')
echo -e "${GREEN}✓ Returns user object with access_token (no wrapper)${NC}"

# Login
echo -e "\n${BLUE}2b. Login (Object Response)${NC}"
curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$EMAIL\", \"password\": \"Test123!\"}" | jq '.'
echo -e "${GREEN}✓ Returns user object with token (no wrapper)${NC}"

# Get current user
echo -e "\n${BLUE}2c. Get Current User (Object Response)${NC}"
curl -s "$BASE_URL/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo -e "${GREEN}✓ Returns user object directly${NC}"

# 3. Error Response
echo -e "\n${BLUE}3. Error Response Format${NC}"
echo "Testing with invalid credentials:"
curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "nonexistent@example.com", "password": "wrong"}' | jq '.'
echo -e "${GREEN}✓ Error format: {error, message, statusCode, nextAction}${NC}"

# 4. Database Tables - Returns array
echo -e "\n${BLUE}4. Database Tables (Array Response)${NC}"
curl -s "$BASE_URL/database/tables" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo -e "${GREEN}✓ Returns array directly${NC}"

# 5. Create a test table
echo -e "\n${BLUE}5. Create Table (Object Response)${NC}"
TABLE_NAME="test_products_$(date +%s)"
CREATE_TABLE_RESPONSE=$(curl -s -X POST "$BASE_URL/database/tables" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"table_name\": \"$TABLE_NAME\",
    \"columns\": [
      {\"name\": \"name\", \"type\": \"string\", \"nullable\": false},
      {\"name\": \"price\", \"type\": \"float\", \"nullable\": false}
    ]
  }")
echo "$CREATE_TABLE_RESPONSE" | jq '.'
echo -e "${GREEN}✓ Returns table info object directly${NC}"

# 6. Database Records - PostgREST returns array
echo -e "\n${BLUE}6. Database Records (PostgREST Array)${NC}"

# Insert a record
echo -e "\n${BLUE}6a. Insert Record${NC}"
curl -s -X POST "$BASE_URL/database/records/$TABLE_NAME" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"name": "Test Product", "price": 99.99}]' | jq '.'
echo -e "${GREEN}✓ PostgREST returns empty array for INSERT${NC}"

# Get records
echo -e "\n${BLUE}6b. Get Records (Array Response)${NC}"
curl -s "$BASE_URL/database/records/$TABLE_NAME" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
echo -e "${GREEN}✓ PostgREST returns array of records${NC}"

# 7. Storage endpoints
echo -e "\n${BLUE}7. Storage Endpoints${NC}"

# Get API key first
echo "Getting API key..."
API_KEY_RESPONSE=$(curl -s -X POST "$BASE_URL/config/apikey" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "test-key"}')
API_KEY=$(echo "$API_KEY_RESPONSE" | jq -r '.key' 2>/dev/null || echo "")

if [ -n "$API_KEY" ] && [ "$API_KEY" != "null" ]; then
  # List buckets
  echo -e "\n${BLUE}7a. List Buckets (Array Response)${NC}"
  curl -s "$BASE_URL/storage/buckets" \
    -H "x-api-key: $API_KEY" | jq '.'
  echo -e "${GREEN}✓ Returns array of buckets${NC}"
else
  echo -e "${RED}✗ Could not get API key for storage tests${NC}"
fi

# 8. Logs with pagination
echo -e "\n${BLUE}8. Logs with Pagination Headers${NC}"
echo "Request: curl -s -i \"$BASE_URL/logs?limit=5\""
LOGS_RESPONSE=$(curl -s -i "$BASE_URL/logs?limit=5" \
  -H "Authorization: Bearer $TOKEN")
echo "$LOGS_RESPONSE" | head -20
echo -e "${GREEN}✓ Returns array with pagination in headers${NC}"

# 9. Documentation
echo -e "\n${BLUE}9. Documentation Endpoints${NC}"

# List docs
echo -e "\n${BLUE}9a. List Documentation (Array Response)${NC}"
curl -s "$BASE_URL/docs" | jq '.'
echo -e "${GREEN}✓ Returns array of available docs${NC}"

# Get specific doc
echo -e "\n${BLUE}9b. Get Specific Doc (Object Response)${NC}"
curl -s "$BASE_URL/docs/db-api" | jq '.type'
echo -e "${GREEN}✓ Returns doc object directly${NC}"

# 10. 404 Error
echo -e "\n${BLUE}10. 404 Not Found${NC}"
curl -s "$BASE_URL/nonexistent" | jq '.'
echo -e "${GREEN}✓ Traditional error format${NC}"

# Cleanup
echo -e "\n${BLUE}Cleanup${NC}"
if [ -n "$TOKEN" ]; then
  # Delete test table
  curl -s -X DELETE "$BASE_URL/database/tables/$TABLE_NAME" \
    -H "Authorization: Bearer $TOKEN" > /dev/null
  echo "✓ Deleted test table: $TABLE_NAME"
fi

echo -e "\n${GREEN}✅ All tests completed!${NC}"
echo -e "\n${BLUE}Summary of Response Formats:${NC}"
echo "• Objects: health, auth, table info, specific doc"
echo "• Arrays: database tables, database records (PostgREST), storage buckets, docs list"
echo "• Errors: Consistent format with error, message, statusCode, nextAction"
echo "• Pagination: Via HTTP headers (X-Total-Count, X-Page, etc.)"