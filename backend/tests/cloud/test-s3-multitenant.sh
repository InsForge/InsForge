#!/bin/bash

# Test script for multi-tenant S3 storage
# This script tests the storage API with S3 backend and app key folder structure

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Load .env file if AWS variables not already set
if [ -z "$AWS_S3_BUCKET" ] && [ -f "$PROJECT_ROOT/.env" ]; then
    echo "Loading environment from .env file..."
    set -a  # automatically export all variables
    source "$PROJECT_ROOT/.env"
    set +a  # turn off automatic export
fi

# Source test configuration
source "$SCRIPT_DIR/../test-config.sh"

API_KEY="${ACCESS_API_KEY:-}"
# Use TEST_API_BASE if set, otherwise default to localhost
if [ -n "$TEST_API_BASE" ]; then
    # TEST_API_BASE already includes /api
    BASE_URL="$TEST_API_BASE"
else
    BASE_URL="http://localhost:7130/api"
fi

echo "=== Testing Multi-tenant S3 Storage ==="
echo "Note: Ensure AWS_S3_BUCKET and APP_KEY are set in your .env file"
echo "Base URL: $BASE_URL"
echo "API Key: ${API_KEY:0:10}..." # Show first 10 chars only
echo "AWS Bucket: ${AWS_S3_BUCKET:-not set}"
echo "App Key: ${APP_KEY:-not set}"
echo ""

# Create a test bucket
echo "1. Creating test bucket..."
curl -X POST "$BASE_URL/storage/buckets" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"bucketName": "test-bucket", "isPublic": true}' | jq .

echo ""

# List buckets
echo "2. Listing buckets..."
curl "$BASE_URL/storage/buckets" \
  -H "x-api-key: $API_KEY" | jq .

echo ""

# Upload a file with specific key
echo "3. Uploading file with specific key..."
echo "Test content for S3" > test-file.txt
curl -X PUT "$BASE_URL/storage/test-bucket/test-file.txt" \
  -H "x-api-key: $API_KEY" \
  -F "file=@test-file.txt" | jq .

echo ""

# Upload a file with auto-generated key
echo "4. Uploading file with auto-generated key..."
curl -X POST "$BASE_URL/storage/test-bucket" \
  -H "x-api-key: $API_KEY" \
  -F "file=@test-file.txt" | jq .

echo ""

# List objects in bucket
echo "5. Listing objects in bucket..."
curl "$BASE_URL/storage/test-bucket" \
  -H "x-api-key: $API_KEY" | jq .

echo ""

# Download a file (public bucket, no auth needed)
echo "6. Downloading file from public bucket..."
curl "$BASE_URL/storage/test-bucket/test-file.txt" \
  -o downloaded-file.txt
echo "Downloaded content:"
cat downloaded-file.txt
echo ""

# Update bucket visibility to private
echo "7. Making bucket private..."
curl -X PATCH "$BASE_URL/storage/buckets/test-bucket" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"isPublic": false}' | jq .

echo ""

# Try downloading from private bucket without auth (should fail)
echo "8. Trying to download from private bucket without auth (should fail)..."
curl -v "$BASE_URL/api/storage/test-bucket/test-file.txt" 2>&1 | grep "< HTTP"

echo ""

# Download from private bucket with auth
echo "9. Downloading from private bucket with auth..."
curl "$BASE_URL/storage/test-bucket/test-file.txt" \
  -H "x-api-key: $API_KEY" \
  -o downloaded-private.txt
echo "Downloaded content:"
cat downloaded-private.txt
echo ""

# Delete a file
echo "10. Deleting a file..."
curl -X DELETE "$BASE_URL/storage/test-bucket/test-file.txt" \
  -H "x-api-key: $API_KEY" | jq .

echo ""

# Delete the bucket
echo "11. Deleting the bucket..."
curl -X DELETE "$BASE_URL/storage/test-bucket" \
  -H "x-api-key: $API_KEY" | jq .

echo ""

# Clean up
rm -f test-file.txt downloaded-file.txt downloaded-private.txt

echo "=== S3 Multi-tenant Storage Test Complete ==="
echo ""
echo "When AWS_S3_BUCKET is set, files are stored in S3 with structure:"
echo "  s3://\${AWS_S3_BUCKET}/\${APP_KEY}/\${bucket}/\${key}"
echo ""
echo "Example: s3://my-bucket/app12345/test-bucket/test-file.txt"