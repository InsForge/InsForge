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
BUCKET="${BUCKET:-e2e-test-$$}"

log() { printf "\n\033[1;34m--> %s\033[0m\n" "$*"; }
ok() { printf "   \033[1;32mOK\033[0m %s\n" "$*"; }
warn() { printf "   \033[1;33mWARN\033[0m %s\n" "$*"; }

# State set progressively; the trap below cleans up what was actually created.
AK=""
SK=""
KID=""
CREATED_BUCKET=0

cleanup() {
  local rc=$?
  set +e
  if [[ -n "${AK:-}" && $CREATED_BUCKET -eq 1 ]]; then
    log "cleanup: removing bucket $BUCKET"
    AWS_ACCESS_KEY_ID="$AK" AWS_SECRET_ACCESS_KEY="$SK" AWS_DEFAULT_REGION="us-east-2" \
      aws --endpoint-url "$BASE_URL/storage/v1/s3" s3 rm "s3://$BUCKET/" --recursive >/dev/null 2>&1 || \
        warn "bucket contents cleanup failed; bucket may have residual objects"
    AWS_ACCESS_KEY_ID="$AK" AWS_SECRET_ACCESS_KEY="$SK" AWS_DEFAULT_REGION="us-east-2" \
      aws --endpoint-url "$BASE_URL/storage/v1/s3" s3 rb "s3://$BUCKET" >/dev/null 2>&1 || \
        warn "bucket removal failed; try manually"
  fi
  if [[ -n "${KID:-}" ]]; then
    log "cleanup: revoking access key"
    curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_JWT" \
      "$BASE_URL/api/storage/s3/access-keys/$KID" > /dev/null 2>&1 || \
        warn "access key revocation failed; revoke manually"
  fi
  rm -f /tmp/e2e-small.txt /tmp/e2e-small.out /tmp/e2e-big.bin /tmp/e2e-big.out
  rm -rf /tmp/e2e-dir /tmp/e2e-dir-back
  exit $rc
}
trap cleanup EXIT

log "Creating S3 access key"
RESP=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"description":"e2e test"}' \
  "$BASE_URL/api/storage/s3/access-keys")
AK=$(echo "$RESP" | jq -r '.data.accessKeyId')
SK=$(echo "$RESP" | jq -r '.data.secretAccessKey')
KID=$(echo "$RESP" | jq -r '.data.id')
if [[ -z "$AK" || "$AK" == "null" || -z "$SK" || "$SK" == "null" || -z "$KID" || "$KID" == "null" ]]; then
  printf "failed to create access key, response was: %s\n" "$RESP" >&2
  exit 1
fi
ok "access key $AK"

export AWS_ACCESS_KEY_ID="$AK"
export AWS_SECRET_ACCESS_KEY="$SK"
export AWS_DEFAULT_REGION="us-east-2"
AWSCMD=(aws --endpoint-url "$BASE_URL/storage/v1/s3")

log "Listing buckets"
"${AWSCMD[@]}" s3 ls

log "Creating bucket $BUCKET"
"${AWSCMD[@]}" s3 mb "s3://$BUCKET"
CREATED_BUCKET=1

log "Uploading a small file"
echo "hello world" > /tmp/e2e-small.txt
"${AWSCMD[@]}" s3 cp /tmp/e2e-small.txt "s3://$BUCKET/small.txt"
ok "upload"

log "Downloading it back"
"${AWSCMD[@]}" s3 cp "s3://$BUCKET/small.txt" /tmp/e2e-small.out
diff /tmp/e2e-small.txt /tmp/e2e-small.out
ok "round-trip identity"

log "Listing objects"
"${AWSCMD[@]}" s3 ls "s3://$BUCKET/"

log "Uploading 100 MB file (triggers multipart)"
dd if=/dev/urandom of=/tmp/e2e-big.bin bs=1M count=100 status=none
"${AWSCMD[@]}" s3 cp /tmp/e2e-big.bin "s3://$BUCKET/big.bin"

log "Downloading 100 MB file"
"${AWSCMD[@]}" s3 cp "s3://$BUCKET/big.bin" /tmp/e2e-big.out
diff /tmp/e2e-big.bin /tmp/e2e-big.out
ok "multipart round-trip"

log "aws s3 sync roundtrip"
mkdir -p /tmp/e2e-dir/a /tmp/e2e-dir/b
echo A > /tmp/e2e-dir/a/x.txt
echo B > /tmp/e2e-dir/b/y.txt
"${AWSCMD[@]}" s3 sync /tmp/e2e-dir "s3://$BUCKET/dir/"
rm -rf /tmp/e2e-dir-back
"${AWSCMD[@]}" s3 sync "s3://$BUCKET/dir" /tmp/e2e-dir-back
diff -r /tmp/e2e-dir /tmp/e2e-dir-back
ok "sync"

printf "\n\033[1;32mAll S3 gateway smoke checks passed.\033[0m\n"
# cleanup() (via trap) removes the bucket and access key even on early failure.
