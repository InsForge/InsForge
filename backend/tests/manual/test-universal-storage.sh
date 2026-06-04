#!/bin/bash

# Test script for universal storage API with presigned URL support
# Tests both the "backend decides" approach for S3 and local storage

set -e

API_URL="http://localhost:7130"
BUCKET_NAME="test-universal-bucket"
TEST_FILE="test-upload.txt"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== Universal Storage API Test ==="
echo ""

# Create test file
echo "This is a test file for universal storage upload" > $TEST_FILE
FILE_SIZE=$(stat -f%z "$TEST_FILE" 2>/dev/null || stat -c%s "$TEST_FILE" 2>/dev/null)

# Step 1: Login to get auth token
echo "1. Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST $API_URL/api/auth/admin/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "username": "root",
    "password": "change-this-password"
  }')

TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.accessToken')
if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo -e "${RED}✗ Failed to login${NC}"
  echo $LOGIN_RESPONSE | jq .
  exit 1
fi
echo -e "${GREEN}✓ Logged in successfully${NC}"

# Step 2: Create bucket
echo ""
echo "2. Creating bucket '$BUCKET_NAME'..."
CREATE_RESPONSE=$(curl -s -X POST $API_URL/api/storage/buckets \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"bucketName\": \"$BUCKET_NAME\",
    \"isPublic\": true
  }")

echo $CREATE_RESPONSE | jq .

# Step 3: Request upload strategy
echo ""
echo "3. Requesting upload strategy (backend decides)..."
UPLOAD_STRATEGY=$(curl -s -X POST $API_URL/api/storage/buckets/$BUCKET_NAME/upload-strategy \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"filename\": \"$TEST_FILE\",
    \"contentType\": \"text/plain\",
    \"size\": $FILE_SIZE
  }")

echo -e "${YELLOW}Upload Strategy Response:${NC}"
echo $UPLOAD_STRATEGY | jq .

# Extract strategy details
METHOD=$(echo $UPLOAD_STRATEGY | jq -r '.method')
UPLOAD_URL=$(echo $UPLOAD_STRATEGY | jq -r '.uploadUrl')
KEY=$(echo $UPLOAD_STRATEGY | jq -r '.key')
CONFIRM_REQUIRED=$(echo $UPLOAD_STRATEGY | jq -r '.confirmRequired')

if [ "$METHOD" == "null" ] || [ -z "$METHOD" ]; then
  echo -e "${RED}✗ Failed to get upload strategy${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}✓ Got upload strategy:${NC}"
echo "  - Method: $METHOD"
echo "  - Upload URL: $UPLOAD_URL"
echo "  - Key: $KEY"
echo "  - Confirm Required: $CONFIRM_REQUIRED"

# Step 4: Upload based on strategy
echo ""
echo "4. Uploading file using $METHOD method..."

if [ "$METHOD" == "presigned" ]; then
  echo "Using presigned URL upload (S3)..."
  
  # Build multipart form data with fields from strategy
  FIELDS=$(echo $UPLOAD_STRATEGY | jq -r '.fields')
  FORM_FIELDS=""
  
  if [ "$FIELDS" != "null" ] && [ "$FIELDS" != "{}" ]; then
    for field in $(echo $FIELDS | jq -r 'to_entries[] | @base64'); do
      _jq() {
        echo ${field} | base64 --decode | jq -r ${1}
      }
      FIELD_NAME=$(_jq '.key')
      FIELD_VALUE=$(_jq '.value')
      FORM_FIELDS="$FORM_FIELDS -F $FIELD_NAME=$FIELD_VALUE"
    done
  fi
  
  # Upload to S3
  UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST $UPLOAD_URL \
    $FORM_FIELDS \
    -F "file=@$TEST_FILE")
  
  HTTP_CODE=$(echo "$UPLOAD_RESPONSE" | tail -n1)
  
  if [ "$HTTP_CODE" -ge "200" ] && [ "$HTTP_CODE" -lt "300" ]; then
    echo -e "${GREEN}✓ File uploaded to S3 (HTTP $HTTP_CODE)${NC}"
  else
    echo -e "${RED}✗ S3 upload failed (HTTP $HTTP_CODE)${NC}"
    echo "Response: $(echo "$UPLOAD_RESPONSE" | head -n-1)"
  fi
  
elif [ "$METHOD" == "direct" ]; then
  echo "Using direct upload (Local Storage)..."
  
  # For local storage, upload directly to backend
  if [[ "$UPLOAD_URL" == /* ]]; then
    # Relative URL, prepend API_URL
    FULL_URL="${API_URL}${UPLOAD_URL}"
  else
    FULL_URL="$UPLOAD_URL"
  fi
  
  UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "$FULL_URL" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@$TEST_FILE")
  
  HTTP_CODE=$(echo "$UPLOAD_RESPONSE" | tail -n1)
  
  if [ "$HTTP_CODE" -ge "200" ] && [ "$HTTP_CODE" -lt "300" ]; then
    echo -e "${GREEN}✓ File uploaded directly to backend (HTTP $HTTP_CODE)${NC}"
  else
    echo -e "${RED}✗ Direct upload failed (HTTP $HTTP_CODE)${NC}"
    echo "Response: $(echo "$UPLOAD_RESPONSE" | head -n-1)"
  fi
else
  echo -e "${RED}✗ Unknown upload method: $METHOD${NC}"
  exit 1
fi

# Step 5: Confirm upload if required
if [ "$CONFIRM_REQUIRED" == "true" ]; then
  echo ""
  echo "5. Confirming upload..."
  
  CONFIRM_RESPONSE=$(curl -s -X POST $API_URL/api/storage/buckets/$BUCKET_NAME/objects/$KEY/confirm-upload \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{
      \"size\": $FILE_SIZE,
      \"contentType\": \"text/plain\"
    }")
  
  echo -e "${YELLOW}Confirmation Response:${NC}"
  echo $CONFIRM_RESPONSE | jq .
  
  CONFIRM_KEY=$(echo $CONFIRM_RESPONSE | jq -r '.key')
  if [ "$CONFIRM_KEY" == "$KEY" ]; then
    echo -e "${GREEN}✓ Upload confirmed successfully${NC}"
  else
    echo -e "${RED}✗ Upload confirmation failed${NC}"
  fi
else
  echo ""
  echo "5. No confirmation required for $METHOD upload"
fi

# Step 6: Get download URL
echo ""
echo "6. Getting download URL..."
DOWNLOAD_STRATEGY=$(curl -s "${API_URL}/api/storage/buckets/${BUCKET_NAME}/download-strategy/objects/${KEY}" \
  -H "Authorization: Bearer $TOKEN")

echo -e "${YELLOW}Download Strategy Response:${NC}"
echo $DOWNLOAD_STRATEGY | jq .

DOWNLOAD_METHOD=$(echo $DOWNLOAD_STRATEGY | jq -r '.method')
DOWNLOAD_URL=$(echo $DOWNLOAD_STRATEGY | jq -r '.url')
EXPIRES_AT=$(echo $DOWNLOAD_STRATEGY | jq -r '.expiresAt')

echo ""
echo -e "${GREEN}✓ Got download strategy:${NC}"
echo "  - Method: $DOWNLOAD_METHOD"
echo "  - URL: $DOWNLOAD_URL"
if [ "$EXPIRES_AT" != "null" ]; then
  echo "  - Expires: $EXPIRES_AT"
fi

# Step 7: Test download
echo ""
echo "7. Testing download..."

if [ "$DOWNLOAD_METHOD" == "presigned" ]; then
  # Direct download from S3 with presigned URL
  curl -s -o downloaded-$TEST_FILE "$DOWNLOAD_URL"
elif [ "$DOWNLOAD_METHOD" == "direct" ]; then
  # Download from backend
  if [[ "$DOWNLOAD_URL" == /* ]]; then
    FULL_DOWNLOAD_URL="${API_URL}${DOWNLOAD_URL}"
  else
    FULL_DOWNLOAD_URL="$DOWNLOAD_URL"
  fi
  
  curl -s -o downloaded-$TEST_FILE "$FULL_DOWNLOAD_URL" \
    -H "Authorization: Bearer $TOKEN"
fi

if cmp -s "$TEST_FILE" "downloaded-$TEST_FILE"; then
  echo -e "${GREEN}✓ Downloaded file matches original${NC}"
else
  echo -e "${RED}✗ Downloaded file doesn't match${NC}"
fi

# Step 8: List objects
echo ""
echo "8. Listing objects in bucket..."
LIST_RESPONSE=$(curl -s $API_URL/api/storage/buckets/$BUCKET_NAME/objects \
  -H "Authorization: Bearer $TOKEN")

OBJECT_COUNT=$(echo $LIST_RESPONSE | jq '.objects | length')
echo -e "${GREEN}✓ Found $OBJECT_COUNT object(s) in bucket${NC}"

# Cleanup
echo ""
echo "9. Cleaning up..."

# Delete the uploaded object
DELETE_RESPONSE=$(curl -s -X DELETE $API_URL/api/storage/buckets/$BUCKET_NAME/objects/$KEY \
  -H "Authorization: Bearer $TOKEN")
echo "  - Deleted object: $KEY"

# Delete the bucket
DELETE_BUCKET_RESPONSE=$(curl -s -X DELETE $API_URL/api/storage/buckets/$BUCKET_NAME \
  -H "Authorization: Bearer $TOKEN")
echo "  - Deleted bucket: $BUCKET_NAME"

# Remove test files
rm -f $TEST_FILE downloaded-$TEST_FILE

echo ""
echo "=== Test Complete ==="
echo ""
echo -e "${YELLOW}Summary:${NC}"
echo "- The backend successfully returned upload/download strategies"
echo "- Upload method was: $METHOD"
echo "- Download method was: $DOWNLOAD_METHOD"
echo "- For S3: Uses presigned URLs (direct to S3)"
echo "- For Local: Uses direct upload to backend"
echo "- The SDK can use the same code for both backends!"
