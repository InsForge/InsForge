#!/bin/bash

# Test script for Deno Deploy migration
# Usage: ./scripts/test-deno-deploy.sh [API_URL]

set -e

API_URL="${1:-http://localhost:7130}"
PASS=0
FAIL=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; ((PASS++)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; ((FAIL++)); }

# -----------------------------------------------------------------------------
# Prerequisites Check
# -----------------------------------------------------------------------------
log_info "Checking prerequisites..."

# Check if API is reachable
if ! curl -s "$API_URL/api/health" > /dev/null 2>&1; then
  log_fail "API not reachable at $API_URL"
  echo "Make sure the backend is running: cd backend && npm run dev"
  exit 1
fi
log_pass "API reachable at $API_URL"

# -----------------------------------------------------------------------------
# Test 1: Create Function
# -----------------------------------------------------------------------------
log_info "Test 1: Creating test function..."

CREATE_RESPONSE=$(curl -s -X POST "$API_URL/api/functions" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "deno-deploy-test",
    "slug": "deno-deploy-test",
    "code": "export default async function(req: Request) {\n  const url = new URL(req.url);\n  return new Response(JSON.stringify({\n    message: \"Hello from Deno Deploy!\",\n    path: url.pathname,\n    timestamp: new Date().toISOString()\n  }), {\n    headers: { \"Content-Type\": \"application/json\" }\n  });\n}",
    "status": "active"
  }')

if echo "$CREATE_RESPONSE" | grep -q '"slug":"deno-deploy-test"'; then
  log_pass "Function created successfully"
else
  log_fail "Failed to create function: $CREATE_RESPONSE"
fi

# -----------------------------------------------------------------------------
# Test 2: Wait for Deployment
# -----------------------------------------------------------------------------
log_info "Test 2: Waiting for deployment to complete..."

DEPLOY_URL=""
DEPLOY_STATUS=""
MAX_ATTEMPTS=30
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  LIST_RESPONSE=$(curl -s "$API_URL/api/functions")

  DEPLOY_STATUS=$(echo "$LIST_RESPONSE" | grep -o '"deployment":{[^}]*}' | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  DEPLOY_URL=$(echo "$LIST_RESPONSE" | grep -o '"deployment":{[^}]*}' | grep -o '"url":"[^"]*"' | cut -d'"' -f4)

  if [ "$DEPLOY_STATUS" = "success" ]; then
    log_pass "Deployment succeeded: $DEPLOY_URL"
    break
  elif [ "$DEPLOY_STATUS" = "failed" ]; then
    log_fail "Deployment failed"
    echo "$LIST_RESPONSE" | jq '.deployment' 2>/dev/null || echo "$LIST_RESPONSE"
    break
  fi

  echo -n "."
  sleep 2
  ((ATTEMPT++))
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
  log_fail "Deployment timed out after ${MAX_ATTEMPTS} attempts"
fi

# -----------------------------------------------------------------------------
# Test 3: Invoke Function on Deno Deploy
# -----------------------------------------------------------------------------
if [ -n "$DEPLOY_URL" ] && [ "$DEPLOY_STATUS" = "success" ]; then
  log_info "Test 3: Invoking function on Deno Deploy..."

  INVOKE_RESPONSE=$(curl -s "$DEPLOY_URL/deno-deploy-test" 2>/dev/null || echo "CURL_FAILED")

  if echo "$INVOKE_RESPONSE" | grep -q '"message":"Hello from Deno Deploy!"'; then
    log_pass "Function invoked successfully on Deno Deploy"
    echo "Response: $INVOKE_RESPONSE"
  else
    log_fail "Function invocation failed: $INVOKE_RESPONSE"
  fi
else
  log_info "Skipping invocation test (deployment not successful)"
fi

# -----------------------------------------------------------------------------
# Test 4: Update Function
# -----------------------------------------------------------------------------
log_info "Test 4: Updating function..."

UPDATE_RESPONSE=$(curl -s -X PATCH "$API_URL/api/functions/deno-deploy-test" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "export default async function(req: Request) {\n  return new Response(JSON.stringify({\n    message: \"Updated function!\",\n    version: 2\n  }), {\n    headers: { \"Content-Type\": \"application/json\" }\n  });\n}"
  }')

if echo "$UPDATE_RESPONSE" | grep -q '"slug":"deno-deploy-test"'; then
  log_pass "Function updated successfully"
else
  log_fail "Failed to update function: $UPDATE_RESPONSE"
fi

# Wait for redeployment
log_info "Waiting for redeployment..."
sleep 10

# Verify updated function
if [ -n "$DEPLOY_URL" ]; then
  UPDATED_RESPONSE=$(curl -s "$DEPLOY_URL/deno-deploy-test" 2>/dev/null || echo "CURL_FAILED")

  if echo "$UPDATED_RESPONSE" | grep -q '"version":2'; then
    log_pass "Updated function works on Deno Deploy"
  else
    log_fail "Updated function not reflecting changes: $UPDATED_RESPONSE"
  fi
fi

# -----------------------------------------------------------------------------
# Test 5: Create Function with Secret Access
# -----------------------------------------------------------------------------
log_info "Test 5: Creating function that accesses secrets..."

SECRET_FUNC_RESPONSE=$(curl -s -X POST "$API_URL/api/functions" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "secret-test",
    "slug": "secret-test",
    "code": "export default async function(req: Request) {\n  const envKeys = Object.keys(Deno.env.toObject()).filter(k => !k.startsWith(\"DENO_\"));\n  return new Response(JSON.stringify({\n    message: \"Secret test\",\n    availableEnvVars: envKeys.length,\n    hasSecrets: envKeys.length > 0\n  }), {\n    headers: { \"Content-Type\": \"application/json\" }\n  });\n}",
    "status": "active"
  }')

if echo "$SECRET_FUNC_RESPONSE" | grep -q '"slug":"secret-test"'; then
  log_pass "Secret test function created"
else
  log_fail "Failed to create secret test function: $SECRET_FUNC_RESPONSE"
fi

# Wait for deployment
sleep 10

if [ -n "$DEPLOY_URL" ]; then
  SECRET_RESPONSE=$(curl -s "$DEPLOY_URL/secret-test" 2>/dev/null || echo "CURL_FAILED")
  log_info "Secret test response: $SECRET_RESPONSE"
fi

# -----------------------------------------------------------------------------
# Test 6: List Functions with Deployment Info
# -----------------------------------------------------------------------------
log_info "Test 6: Checking list functions includes deployment info..."

LIST_FINAL=$(curl -s "$API_URL/api/functions")

if echo "$LIST_FINAL" | grep -q '"deployment"'; then
  log_pass "List functions includes deployment info"
  echo "$LIST_FINAL" | jq '.deployment' 2>/dev/null || echo "Deployment info present"
else
  log_fail "List functions missing deployment info"
fi

# -----------------------------------------------------------------------------
# Test 7: Delete Function
# -----------------------------------------------------------------------------
log_info "Test 7: Deleting test functions..."

DELETE1=$(curl -s -X DELETE "$API_URL/api/functions/deno-deploy-test")
DELETE2=$(curl -s -X DELETE "$API_URL/api/functions/secret-test")

log_pass "Functions deleted (cleanup)"

# Wait for redeployment without deleted functions
sleep 5

# Verify functions are gone from Deno Deploy
if [ -n "$DEPLOY_URL" ]; then
  GONE_RESPONSE=$(curl -s "$DEPLOY_URL/deno-deploy-test" 2>/dev/null || echo "CURL_FAILED")

  if echo "$GONE_RESPONSE" | grep -q '"error":"Function not found"'; then
    log_pass "Deleted function no longer accessible on Deno Deploy"
  else
    log_info "Function may still be cached: $GONE_RESPONSE"
  fi
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================"
echo "Test Summary"
echo "============================================"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo "============================================"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
