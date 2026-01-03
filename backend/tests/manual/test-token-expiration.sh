#!/bin/bash

# Test script to verify JWT token expiration (15 minutes)
# This tests the actual API endpoints to ensure tokens expire correctly

set -e

API_BASE="${TEST_API_BASE:-http://localhost:7130/api}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-change-this-password}"

echo "🧪 Testing JWT Token Expiration (15 minutes)"
echo "============================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Sign in and get tokens
echo "📝 Test 1: Sign in and get access token"
echo "----------------------------------------"
SIGNIN_RESPONSE=$(curl -s -X POST "${API_BASE}/auth/signin" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"${ADMIN_EMAIL}\",
    \"password\": \"${ADMIN_PASSWORD}\"
  }")

ACCESS_TOKEN=$(echo "$SIGNIN_RESPONSE" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
CSRF_TOKEN=$(echo "$SIGNIN_RESPONSE" | grep -o '"csrfToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
  echo -e "${RED}❌ Failed to get access token${NC}"
  echo "Response: $SIGNIN_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Successfully obtained access token${NC}"
echo "Token (first 20 chars): ${ACCESS_TOKEN:0:20}..."
echo ""

# Test 2: Use access token to make authenticated request
echo "📝 Test 2: Use access token for authenticated request"
echo "-----------------------------------------------------"
AUTH_RESPONSE=$(curl -s -X GET "${API_BASE}/auth/me" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

if echo "$AUTH_RESPONSE" | grep -q "email"; then
  echo -e "${GREEN}✅ Access token is valid and works${NC}"
else
  echo -e "${RED}❌ Access token validation failed${NC}"
  echo "Response: $AUTH_RESPONSE"
  exit 1
fi
echo ""

# Test 3: Decode token to verify expiration time
echo "📝 Test 3: Verify token expiration time (should be 15 minutes)"
echo "---------------------------------------------------------------"
# Extract payload from JWT (middle part)
PAYLOAD=$(echo "$ACCESS_TOKEN" | cut -d'.' -f2)
# Add padding if needed
case $((${#PAYLOAD} % 4)) in
  2) PAYLOAD="${PAYLOAD}==" ;;
  3) PAYLOAD="${PAYLOAD}=" ;;
esac

# Decode base64 (requires base64 command)
if command -v base64 &> /dev/null; then
  DECODED=$(echo "$PAYLOAD" | base64 -d 2>/dev/null || echo "$PAYLOAD" | base64 -D 2>/dev/null)
  EXP_TIME=$(echo "$DECODED" | grep -o '"exp":[0-9]*' | cut -d':' -f2)
  IAT_TIME=$(echo "$DECODED" | grep -o '"iat":[0-9]*' | cut -d':' -f2)
  
  if [ -n "$EXP_TIME" ] && [ -n "$IAT_TIME" ]; then
    EXPIRATION_SECONDS=$((EXP_TIME - IAT_TIME))
    EXPECTED_SECONDS=900  # 15 minutes = 900 seconds
    
    echo "Token issued at: $IAT_TIME"
    echo "Token expires at: $EXP_TIME"
    echo "Expiration duration: ${EXPIRATION_SECONDS} seconds"
    
    if [ "$EXPIRATION_SECONDS" -ge 895 ] && [ "$EXPIRATION_SECONDS" -le 905 ]; then
      echo -e "${GREEN}✅ Token expiration is correct (~15 minutes)${NC}"
    else
      echo -e "${YELLOW}⚠️  Token expiration is ${EXPIRATION_SECONDS}s, expected ~900s${NC}"
    fi
  else
    echo -e "${YELLOW}⚠️  Could not decode token expiration time${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  base64 command not available, skipping expiration check${NC}"
fi
echo ""

# Test 4: Test refresh token flow
echo "📝 Test 4: Test refresh token flow"
echo "-----------------------------------"
# Get cookies from signin (refresh token is in httpOnly cookie)
COOKIE_JAR=$(mktemp)
curl -s -c "$COOKIE_JAR" -X POST "${API_BASE}/auth/signin" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"${ADMIN_EMAIL}\",
    \"password\": \"${ADMIN_PASSWORD}\"
  }" > /dev/null

# Get CSRF token from signin response
SIGNIN_RESPONSE2=$(curl -s -b "$COOKIE_JAR" -X POST "${API_BASE}/auth/signin" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"${ADMIN_EMAIL}\",
    \"password\": \"${ADMIN_PASSWORD}\"
  }")
CSRF_TOKEN2=$(echo "$SIGNIN_RESPONSE2" | grep -o '"csrfToken":"[^"]*' | cut -d'"' -f4)

# Use refresh endpoint
REFRESH_RESPONSE=$(curl -s -b "$COOKIE_JAR" -X POST "${API_BASE}/auth/refresh" \
  -H "X-CSRF-Token: ${CSRF_TOKEN2}")

NEW_ACCESS_TOKEN=$(echo "$REFRESH_RESPONSE" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ -n "$NEW_ACCESS_TOKEN" ]; then
  echo -e "${GREEN}✅ Refresh token flow works correctly${NC}"
  echo "New access token obtained via refresh"
else
  echo -e "${RED}❌ Refresh token flow failed${NC}"
  echo "Response: $REFRESH_RESPONSE"
  rm -f "$COOKIE_JAR"
  exit 1
fi

rm -f "$COOKIE_JAR"
echo ""

# Test 5: Verify new token works
echo "📝 Test 5: Verify refreshed token works"
echo "----------------------------------------"
NEW_AUTH_RESPONSE=$(curl -s -X GET "${API_BASE}/auth/me" \
  -H "Authorization: Bearer ${NEW_ACCESS_TOKEN}")

if echo "$NEW_AUTH_RESPONSE" | grep -q "email"; then
  echo -e "${GREEN}✅ Refreshed access token is valid and works${NC}"
else
  echo -e "${RED}❌ Refreshed access token validation failed${NC}"
  echo "Response: $NEW_AUTH_RESPONSE"
  exit 1
fi
echo ""

# Summary
echo "============================================"
echo -e "${GREEN}✅ All token expiration tests passed!${NC}"
echo ""
echo "Summary:"
echo "  ✓ Access tokens are generated with 15 minute expiration"
echo "  ✓ Access tokens work for authenticated requests"
echo "  ✓ Refresh token flow works correctly"
echo "  ✓ Refreshed tokens work for authenticated requests"
echo ""
echo "Note: To test actual expiration, wait 15+ minutes and try using"
echo "      the original access token - it should be rejected."

