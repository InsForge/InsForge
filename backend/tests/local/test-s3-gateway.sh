#!/usr/bin/env bash
# End-to-end smoke test for /storage/v1/s3.
# Requires:
#   - backend running on $BASE_URL (default http://localhost:3000) against a
#     real S3 backend (MinIO via docker-compose.minio.yml works fine)
#   - ADMIN_JWT exported (a project_admin token)
#   - aws CLI and jq installed
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_JWT="${ADMIN_JWT:?please export ADMIN_JWT}"

log() { printf "\n\033[1;34m--> %s\033[0m\n" "$*"; }
ok() { printf "   \033[1;32mOK\033[0m %s\n" "$*"; }

log "Creating S3 access key"
RESP=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"description":"e2e test"}' \
  "$BASE_URL/api/storage/s3/access-keys")
AK=$(echo "$RESP" | jq -r '.data.accessKeyId')
SK=$(echo "$RESP" | jq -r '.data.secretAccessKey')
KID=$(echo "$RESP" | jq -r '.data.id')
ok "access key $AK"

export AWS_ACCESS_KEY_ID="$AK"
export AWS_SECRET_ACCESS_KEY="$SK"
export AWS_DEFAULT_REGION="us-east-2"
AWSCMD=(aws --endpoint-url "$BASE_URL/storage/v1/s3")

log "Listing buckets"
"${AWSCMD[@]}" s3 ls

log "Creating bucket e2e-test"
"${AWSCMD[@]}" s3 mb s3://e2e-test || true

log "Uploading a small file"
echo "hello world" > /tmp/e2e-small.txt
"${AWSCMD[@]}" s3 cp /tmp/e2e-small.txt s3://e2e-test/small.txt
ok "upload"

log "Downloading it back"
"${AWSCMD[@]}" s3 cp s3://e2e-test/small.txt /tmp/e2e-small.out
diff /tmp/e2e-small.txt /tmp/e2e-small.out
ok "round-trip identity"

log "Listing objects"
"${AWSCMD[@]}" s3 ls s3://e2e-test/

log "Uploading 100 MB file (triggers multipart)"
dd if=/dev/urandom of=/tmp/e2e-big.bin bs=1M count=100 status=none
"${AWSCMD[@]}" s3 cp /tmp/e2e-big.bin s3://e2e-test/big.bin

log "Downloading 100 MB file"
"${AWSCMD[@]}" s3 cp s3://e2e-test/big.bin /tmp/e2e-big.out
diff /tmp/e2e-big.bin /tmp/e2e-big.out
ok "multipart round-trip"

log "aws s3 sync roundtrip"
mkdir -p /tmp/e2e-dir/a /tmp/e2e-dir/b
echo A > /tmp/e2e-dir/a/x.txt
echo B > /tmp/e2e-dir/b/y.txt
"${AWSCMD[@]}" s3 sync /tmp/e2e-dir s3://e2e-test/dir/
rm -rf /tmp/e2e-dir-back
"${AWSCMD[@]}" s3 sync s3://e2e-test/dir /tmp/e2e-dir-back
diff -r /tmp/e2e-dir /tmp/e2e-dir-back
ok "sync"

log "Deleting everything"
"${AWSCMD[@]}" s3 rm s3://e2e-test/ --recursive
"${AWSCMD[@]}" s3 rb s3://e2e-test
ok "cleanup"

log "Revoking access key"
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_JWT" \
  "$BASE_URL/api/storage/s3/access-keys/$KID" > /dev/null
ok "revoked"

printf "\n\033[1;32mAll S3 gateway smoke checks passed.\033[0m\n"
