#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

API_URL="http://localhost:7130"
ADMIN_TOKEN=""

echo -e "${YELLOW}=== InsForge Deployment API Test ===${NC}\n"

# Step 1: Login to get admin token
echo -e "${YELLOW}Step 1: Logging in as admin...${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/admin/sessions" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "change-this-password"
  }')

ADMIN_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$ADMIN_TOKEN" ]; then
  echo -e "${RED}❌ Failed to get admin token${NC}"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Got admin token${NC}\n"

# Step 2: Read the test HTML file
echo -e "${YELLOW}Step 2: Reading test HTML file...${NC}"
if [ ! -f "test-deployment.html" ]; then
  echo -e "${RED}❌ test-deployment.html not found${NC}"
  exit 1
fi

HTML_CONTENT=$(cat test-deployment.html | base64)
echo -e "${GREEN}✅ HTML file loaded${NC}\n"

# Step 3: Create deployment
echo -e "${YELLOW}Step 3: Creating deployment...${NC}"
DEPLOYMENT_RESPONSE=$(curl -s -X POST "$API_URL/api/deployments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d "{
    \"projectName\": \"test-deployment\",
    \"files\": [
      {
        \"path\": \"index.html\",
        \"content\": \"$HTML_CONTENT\"
      }
    ]
  }")

echo "Response: $DEPLOYMENT_RESPONSE" | jq '.' 2>/dev/null || echo "$DEPLOYMENT_RESPONSE"

DEPLOYMENT_URL=$(echo $DEPLOYMENT_RESPONSE | grep -o '"deploymenturl":"[^"]*' | cut -d'"' -f4)

if [ -z "$DEPLOYMENT_URL" ]; then
  echo -e "${RED}❌ Deployment failed${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Deployment created successfully!${NC}"
echo -e "Deployment URL: ${GREEN}$DEPLOYMENT_URL${NC}\n"

# Step 4: Get deployment info
echo -e "${YELLOW}Step 4: Getting deployment info...${NC}"
GET_RESPONSE=$(curl -s -X GET "$API_URL/api/deployments" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

echo "Response: $GET_RESPONSE" | jq '.' 2>/dev/null || echo "$GET_RESPONSE"
echo ""

# Step 5: Verify deployment URL
echo -e "${YELLOW}Step 5: Verifying deployment URL...${NC}"
echo -e "Visit this URL in your browser: ${GREEN}$DEPLOYMENT_URL${NC}"
echo ""
echo -e "${YELLOW}Testing URL accessibility...${NC}"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$DEPLOYMENT_URL")

if [ "$HTTP_STATUS" = "200" ]; then
  echo -e "${GREEN}✅ Deployment is accessible (HTTP $HTTP_STATUS)${NC}"
else
  echo -e "${YELLOW}⚠️  Deployment returned HTTP $HTTP_STATUS${NC}"
  echo -e "${YELLOW}Note: CloudFront may take a few minutes to propagate${NC}"
fi

echo ""
echo -e "${GREEN}=== Test Complete ===${NC}"
echo -e "Deployment URL: ${GREEN}$DEPLOYMENT_URL${NC}"
echo ""
echo -e "${YELLOW}Optional: Delete deployment${NC}"
echo -e "Run: curl -X DELETE $API_URL/api/deployments -H 'Authorization: Bearer $ADMIN_TOKEN'"
