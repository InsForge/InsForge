#!/usr/bin/env bash
# End-to-end smoke test for /storage/v1/s3.
# Runs as a "cloud" test — only invoked by run-all-tests.sh when
# AWS_S3_BUCKET and APP_KEY are already set.
#
# Requirements (from the test runner's perspective):
#   - Backend running at $TEST_API_BASE (default http://localhost:7130/api),
#     configured with a real S3 or S3-compatible backend.
#   - ACCESS_API_KEY set (project admin API key).
#   - aws CLI and jq installed.
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Load .env like the sibling cloud test does.
if [ -z "${AWS_S3_BUCKET:-}" ] && [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

# TEST_API_BASE already includes /api (matches sibling cloud tests).
if [ -n "${TEST_API_BASE:-}" ]; then
    API_BASE="$TEST_API_BASE"
else
    API_BASE="http://localhost:7130/api"
fi
# Gateway base: strip trailing /api if present.
GATEWAY_HOST="${API_BASE%/api}"
GATEWAY_URL="$GATEWAY_HOST/storage/v1/s3"

API_KEY="${ACCESS_API_KEY:-}"

# Graceful skip if tooling or creds are missing — run-all-tests.sh treats
# exit 0 as a pass, and CI should not fail for missing prerequisites.
for tool in aws jq curl; do
    if ! command -v "$tool" > /dev/null 2>&1; then
        echo "SKIP: $tool not installed"
        exit 0
    fi
done
if [ -z "$API_KEY" ]; then
    echo "SKIP: ACCESS_API_KEY not set"
    exit 0
fi

BUCKET="${BUCKET:-s3gw-e2e-$$}"

log() { printf "\n\033[1;34m--> %s\033[0m\n" "$*"; }
ok() { printf "   \033[1;32mOK\033[0m %s\n" "$*"; }
warn() { printf "   \033[1;33mWARN\033[0m %s\n" "$*"; }

AK=""
SK=""
KID=""
CREATED_BUCKET=0

cleanup() {
  local rc=$?
  set +e
  if [ -n "$AK" ] && [ $CREATED_BUCKET -eq 1 ]; then
    log "cleanup: removing bucket $BUCKET"
    AWS_ACCESS_KEY_ID="$AK" AWS_SECRET_ACCESS_KEY="$SK" AWS_DEFAULT_REGION="us-east-2" \
      aws --endpoint-url "$GATEWAY_URL" s3 rm "s3://$BUCKET/" --recursive >/dev/null 2>&1 || \
        warn "bucket contents cleanup failed"
    AWS_ACCESS_KEY_ID="$AK" AWS_SECRET_ACCESS_KEY="$SK" AWS_DEFAULT_REGION="us-east-2" \
      aws --endpoint-url "$GATEWAY_URL" s3 rb "s3://$BUCKET" >/dev/null 2>&1 || \
        warn "bucket removal failed"
  fi
  if [ -n "$KID" ]; then
    log "cleanup: revoking access key"
    curl -sS -X DELETE -H "x-api-key: $API_KEY" \
      "$API_BASE/storage/s3/access-keys/$KID" > /dev/null 2>&1 || \
        warn "access key revocation failed"
  fi
  rm -f /tmp/s3gw-small.txt /tmp/s3gw-small.out /tmp/s3gw-big.bin /tmp/s3gw-big.out
  rm -rf /tmp/s3gw-dir /tmp/s3gw-dir-back
  exit "$rc"
}
trap cleanup EXIT

log "Creating S3 access key"
RESP=$(curl -sS -X POST -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"description":"ci e2e"}' \
  "$API_BASE/storage/s3/access-keys")
AK=$(echo "$RESP" | jq -r '.data.accessKeyId // .accessKeyId // empty')
SK=$(echo "$RESP" | jq -r '.data.secretAccessKey // .secretAccessKey // empty')
KID=$(echo "$RESP" | jq -r '.data.id // .id // empty')
if [ -z "$AK" ] || [ -z "$SK" ] || [ -z "$KID" ]; then
    printf "failed to create access key, response was: %s\n" "$RESP" >&2
    exit 1
fi
ok "access key $AK"

export AWS_ACCESS_KEY_ID="$AK"
export AWS_SECRET_ACCESS_KEY="$SK"
export AWS_DEFAULT_REGION="us-east-2"
AWSCMD=(aws --endpoint-url "$GATEWAY_URL")

log "Listing buckets"
"${AWSCMD[@]}" s3 ls

log "Creating bucket $BUCKET"
"${AWSCMD[@]}" s3 mb "s3://$BUCKET"
CREATED_BUCKET=1

log "Uploading a small file"
echo "hello world" > /tmp/s3gw-small.txt
"${AWSCMD[@]}" s3 cp /tmp/s3gw-small.txt "s3://$BUCKET/small.txt"
ok "upload"

log "Downloading it back"
"${AWSCMD[@]}" s3 cp "s3://$BUCKET/small.txt" /tmp/s3gw-small.out
diff /tmp/s3gw-small.txt /tmp/s3gw-small.out
ok "round-trip identity"

log "Listing objects"
"${AWSCMD[@]}" s3 ls "s3://$BUCKET/"

log "Uploading 20 MB file (triggers multipart at aws-cli default threshold)"
dd if=/dev/urandom of=/tmp/s3gw-big.bin bs=1M count=20 status=none
"${AWSCMD[@]}" s3 cp /tmp/s3gw-big.bin "s3://$BUCKET/big.bin"

log "Downloading 20 MB file"
"${AWSCMD[@]}" s3 cp "s3://$BUCKET/big.bin" /tmp/s3gw-big.out
diff /tmp/s3gw-big.bin /tmp/s3gw-big.out
ok "multipart round-trip"

log "aws s3 sync roundtrip"
mkdir -p /tmp/s3gw-dir/a /tmp/s3gw-dir/b
echo A > /tmp/s3gw-dir/a/x.txt
echo B > /tmp/s3gw-dir/b/y.txt
"${AWSCMD[@]}" s3 sync /tmp/s3gw-dir "s3://$BUCKET/dir/"
rm -rf /tmp/s3gw-dir-back
"${AWSCMD[@]}" s3 sync "s3://$BUCKET/dir" /tmp/s3gw-dir-back
diff -r /tmp/s3gw-dir /tmp/s3gw-dir-back
ok "sync"

printf "\n\033[1;32mAll S3 gateway smoke checks passed.\033[0m\n"
# cleanup() via trap handles access-key revocation and bucket teardown.
