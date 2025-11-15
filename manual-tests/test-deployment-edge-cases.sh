#!/bin/bash

# Test deployment API edge cases
API_URL="http://localhost:7130"

echo "=== Testing Deployment API Edge Cases ==="
echo ""

# Test 1: Login as admin
echo "Test 1: Admin login..."
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/admin/sessions" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "change-this-password"}')

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*' | sed 's/"accessToken":"//')

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to get auth token"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Login successful"
echo ""

# Test 2: Deploy with no files (should fail)
echo "Test 2: Deploy with no files (should fail)..."
RESPONSE=$(curl -s -X POST "$API_URL/api/deployments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectName": "empty-test",
    "files": []
  }')

if echo "$RESPONSE" | grep -qi "file.*required\|no files"; then
  echo "✅ Correctly rejected empty files"
else
  echo "❌ Should reject empty files"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 3: Deploy without index.html (should fail)
echo "Test 3: Deploy without index.html (should fail)..."
RESPONSE=$(curl -s -X POST "$API_URL/api/deployments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectName": "no-index",
    "files": [
      {
        "path": "about.html",
        "content": "PGgxPkFib3V0PC9oMT4="
      }
    ]
  }')

if echo "$RESPONSE" | grep -q "index.html"; then
  echo "✅ Correctly rejected missing index.html"
else
  echo "❌ Should reject missing index.html"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 4: Deploy with absolute path (should fail)
echo "Test 4: Deploy with absolute path (should fail)..."
RESPONSE=$(curl -s -X POST "$API_URL/api/deployments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectName": "absolute-path",
    "files": [
      {
        "path": "/etc/passwd",
        "content": "PGgxPkhhY2s8L2gxPg=="
      },
      {
        "path": "index.html",
        "content": "PGgxPkluZGV4PC9oMT4="
      }
    ]
  }')

if echo "$RESPONSE" | grep -q "absolute paths not allowed"; then
  echo "✅ Correctly rejected absolute path"
else
  echo "❌ Should reject absolute path"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 5: Deploy with path traversal (should fail)
echo "Test 5: Deploy with path traversal (should fail)..."
RESPONSE=$(curl -s -X POST "$API_URL/api/deployments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectName": "traversal",
    "files": [
      {
        "path": "../../../etc/passwd",
        "content": "PGgxPkhhY2s8L2gxPg=="
      },
      {
        "path": "index.html",
        "content": "PGgxPkluZGV4PC9oMT4="
      }
    ]
  }')

if echo "$RESPONSE" | grep -q "path traversal not allowed"; then
  echo "✅ Correctly rejected path traversal"
else
  echo "❌ Should reject path traversal"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 6: Deploy with empty file path (should fail)
echo "Test 6: Deploy with empty file path (should fail)..."
RESPONSE=$(curl -s -X POST "$API_URL/api/deployments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectName": "empty-path",
    "files": [
      {
        "path": "",
        "content": "PGgxPkVtcHR5PC9oMT4="
      },
      {
        "path": "index.html",
        "content": "PGgxPkluZGV4PC9oMT4="
      }
    ]
  }')

if echo "$RESPONSE" | grep -qi "path.*required\|cannot be empty"; then
  echo "✅ Correctly rejected empty path"
else
  echo "❌ Should reject empty path"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 7: Valid deployment with multiple files
echo "Test 7: Valid deployment with multiple files..."
RESPONSE=$(curl -s -X POST "$API_URL/api/deployments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectName": "multi-file-test",
    "files": [
      {
        "path": "index.html",
        "content": "PCFET0NUWVBFIGh0bWw+PGh0bWw+PGhlYWQ+PHRpdGxlPlRlc3Q8L3RpdGxlPjwvaGVhZD48Ym9keT48aDE+TXVsdGkgRmlsZSBUZXN0PC9oMT48bGluayByZWw9InN0eWxlc2hlZXQiIGhyZWY9InN0eWxlcy5jc3MiPjwvYm9keT48L2h0bWw+"
      },
      {
        "path": "styles.css",
        "content": "Ym9keSB7IGJhY2tncm91bmQ6ICNmMGYwZjA7IH0="
      },
      {
        "path": "assets/logo.svg",
        "content": "PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCI+PGNpcmNsZSBjeD0iNTAiIGN5PSI1MCIgcj0iNDAiIGZpbGw9IiMwMDdiZmYiLz48L3N2Zz4="
      }
    ]
  }')

DEPLOYMENT_URL=$(echo "$RESPONSE" | grep -o '"deploymenturl":"[^"]*' | sed 's/"deploymenturl":"//')

if [ -n "$DEPLOYMENT_URL" ]; then
  echo "✅ Multi-file deployment successful"
  echo "   URL: $DEPLOYMENT_URL"
else
  echo "❌ Multi-file deployment failed"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 8: Deploy with special characters in project name
echo "Test 8: Deploy with special characters in project name..."
RESPONSE=$(curl -s -X POST "$API_URL/api/deployments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectName": "My-Awesome_Project! (2024) [v1.0]",
    "files": [
      {
        "path": "index.html",
        "content": "PGgxPlNwZWNpYWwgQ2hhcmFjdGVycyBUZXN0PC9oMT4="
      }
    ]
  }')

DEPLOYMENT_URL=$(echo "$RESPONSE" | grep -o '"deploymenturl":"[^"]*' | sed 's/"deploymenturl":"//')

if [ -n "$DEPLOYMENT_URL" ]; then
  echo "✅ Special characters handled correctly"
  echo "   URL: $DEPLOYMENT_URL"
else
  echo "❌ Failed to handle special characters"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 9: Get deployment status
echo "Test 9: Get deployment status..."
RESPONSE=$(curl -s -X GET "$API_URL/api/deployments" \
  -H "Authorization: Bearer $TOKEN")

DEPLOYMENT_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*' | sed 's/"id":"//')

if [ -n "$DEPLOYMENT_ID" ]; then
  echo "✅ Got deployment status"
  echo "   Deployment ID: $DEPLOYMENT_ID"
else
  echo "❌ Failed to get deployment status"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 10: Deploy replaces previous deployment
echo "Test 10: Deploy replaces previous deployment..."
RESPONSE=$(curl -s -X POST "$API_URL/api/deployments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectName": "replacement-test",
    "files": [
      {
        "path": "index.html",
        "content": "PGgxPlJlcGxhY2VtZW50IFRlc3Q8L2gxPjxwPlRoaXMgc2hvdWxkIHJlcGxhY2UgdGhlIHByZXZpb3VzIGRlcGxveW1lbnQ8L3A+"
      }
    ]
  }')

NEW_DEPLOYMENT_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*' | sed 's/"id":"//')

if [ -n "$NEW_DEPLOYMENT_ID" ] && [ "$NEW_DEPLOYMENT_ID" != "$DEPLOYMENT_ID" ]; then
  echo "✅ Deployment replaced successfully"
  echo "   Old ID: $DEPLOYMENT_ID"
  echo "   New ID: $NEW_DEPLOYMENT_ID"
else
  echo "⚠️  Deployment may not have been replaced"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 11: Deploy with nested directories
echo "Test 11: Deploy with nested directories..."
RESPONSE=$(curl -s -X POST "$API_URL/api/deployments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "projectName": "nested-dirs",
    "files": [
      {
        "path": "index.html",
        "content": "PGgxPk5lc3RlZCBEaXJlY3RvcmllczwvaDE+"
      },
      {
        "path": "assets/css/main.css",
        "content": "Ym9keSB7IG1hcmdpbjogMDsgfQ=="
      },
      {
        "path": "assets/js/app.js",
        "content": "Y29uc29sZS5sb2coJ0hlbGxvJyk7"
      },
      {
        "path": "public/images/test.png",
        "content": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      }
    ]
  }')

DEPLOYMENT_URL=$(echo "$RESPONSE" | grep -o '"deploymenturl":"[^"]*' | sed 's/"deploymenturl":"//')

if [ -n "$DEPLOYMENT_URL" ]; then
  echo "✅ Nested directories handled correctly"
  echo "   URL: $DEPLOYMENT_URL"
else
  echo "❌ Failed to handle nested directories"
  echo "Response: $RESPONSE"
fi
echo ""

# Test 12: Deploy without authentication (should fail)
echo "Test 12: Deploy without authentication (should fail)..."
RESPONSE=$(curl -s -X POST "$API_URL/api/deployments" \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "no-auth",
    "files": [
      {
        "path": "index.html",
        "content": "PGgxPk5vIEF1dGg8L2gxPg=="
      }
    ]
  }')

if echo "$RESPONSE" | grep -qi "unauthorized\|forbidden\|token"; then
  echo "✅ Correctly rejected unauthenticated request"
else
  echo "❌ Should reject unauthenticated request"
  echo "Response: $RESPONSE"
fi
echo ""

echo "=== Edge Case Testing Complete ==="
