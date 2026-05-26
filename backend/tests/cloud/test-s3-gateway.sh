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

BUCKET="${BUCKET:-s3gw-e2e-$$-$RANDOM}"

# Per-run temp directory so parallel runs don't collide on /tmp/s3gw-* paths,
# and the EXIT trap always removes exactly the files this run created.
WORK_DIR="$(mktemp -d -t s3gw-e2e.XXXXXX)"

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
  rm -rf "$WORK_DIR"
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
echo "hello world" > "$WORK_DIR/small.txt"
"${AWSCMD[@]}" s3 cp "$WORK_DIR/small.txt" "s3://$BUCKET/small.txt"
ok "upload"

log "Downloading it back"
"${AWSCMD[@]}" s3 cp "s3://$BUCKET/small.txt" "$WORK_DIR/small.out"
diff "$WORK_DIR/small.txt" "$WORK_DIR/small.out"
ok "round-trip identity"

log "Listing objects"
"${AWSCMD[@]}" s3 ls "s3://$BUCKET/"

# Drive multipart explicitly via aws s3api so coverage doesn't depend on the
# caller's aws-cli multipart_threshold config. Two 10 MiB parts + complete.
log "Running multipart upload explicitly (2 parts via s3api)"
dd if=/dev/urandom of="$WORK_DIR/big.bin" bs=1M count=20 status=none
split -b $((10 * 1024 * 1024)) "$WORK_DIR/big.bin" "$WORK_DIR/part-"
PART1="$WORK_DIR/part-aa"
PART2="$WORK_DIR/part-ab"

UPLOAD_ID=$("${AWSCMD[@]}" s3api create-multipart-upload \
  --bucket "$BUCKET" --key big.bin | jq -r '.UploadId')
[ -n "$UPLOAD_ID" ] || { echo "no UploadId returned"; exit 1; }
ok "uploadId $UPLOAD_ID"

ETAG1=$("${AWSCMD[@]}" s3api upload-part \
  --bucket "$BUCKET" --key big.bin --part-number 1 --upload-id "$UPLOAD_ID" \
  --body "$PART1" | jq -r '.ETag')
ETAG2=$("${AWSCMD[@]}" s3api upload-part \
  --bucket "$BUCKET" --key big.bin --part-number 2 --upload-id "$UPLOAD_ID" \
  --body "$PART2" | jq -r '.ETag')

"${AWSCMD[@]}" s3api complete-multipart-upload \
  --bucket "$BUCKET" --key big.bin --upload-id "$UPLOAD_ID" \
  --multipart-upload "$(jq -n --arg e1 "$ETAG1" --arg e2 "$ETAG2" \
    '{Parts: [{PartNumber: 1, ETag: $e1}, {PartNumber: 2, ETag: $e2}]}')" \
  > /dev/null

# AWS S3 multipart ETags are suffixed with "-<part count>" per the docs, so
# this assertion verifies we went through the multipart code path regardless
# of aws-cli config.
HEAD_ETAG=$("${AWSCMD[@]}" s3api head-object --bucket "$BUCKET" --key big.bin | jq -r '.ETag')
case "$HEAD_ETAG" in
  *-2\") ok "multipart upload (ETag=$HEAD_ETAG)" ;;
  *) printf "ETag %s is not multipart-style; expected *-2\n" "$HEAD_ETAG" >&2; exit 1 ;;
esac

log "Downloading 20 MB file"
"${AWSCMD[@]}" s3 cp "s3://$BUCKET/big.bin" "$WORK_DIR/big.out"
diff "$WORK_DIR/big.bin" "$WORK_DIR/big.out"
ok "multipart round-trip"

log "aws s3 sync roundtrip"
mkdir -p "$WORK_DIR/dir/a" "$WORK_DIR/dir/b"
echo A > "$WORK_DIR/dir/a/x.txt"
echo B > "$WORK_DIR/dir/b/y.txt"
"${AWSCMD[@]}" s3 sync "$WORK_DIR/dir" "s3://$BUCKET/dir/"
"${AWSCMD[@]}" s3 sync "s3://$BUCKET/dir" "$WORK_DIR/dir-back"
diff -r "$WORK_DIR/dir" "$WORK_DIR/dir-back"
ok "sync"

# Modern aws-cli (≥2.30) turns on default integrity protections, which sends
# PutObject / UploadPart bodies in aws-chunked framing with
# x-amz-content-sha256: STREAMING-UNSIGNED-PAYLOAD-TRAILER. The 20 MiB `aws
# s3 cp` upload below auto-splits into multipart parts, each one going
# through the UploadPart path in that same format. If this test regresses
# with "Body hash mismatch" or "Only the last chunk is allowed…", the
# gateway has stopped handling that payload-hash variant.
log "aws s3 cp multipart round-trip (exercises UNSIGNED-PAYLOAD-TRAILER UploadPart)"
dd if=/dev/urandom of="$WORK_DIR/multi.bin" bs=1M count=20 status=none
"${AWSCMD[@]}" s3 cp "$WORK_DIR/multi.bin" "s3://$BUCKET/multi.bin"
"${AWSCMD[@]}" s3 cp "s3://$BUCKET/multi.bin" "$WORK_DIR/multi.out"
diff "$WORK_DIR/multi.bin" "$WORK_DIR/multi.out"
MULTI_ETAG=$("${AWSCMD[@]}" s3api head-object --bucket "$BUCKET" --key multi.bin | jq -r '.ETag')
case "$MULTI_ETAG" in
  *-*\") ok "aws-cli multipart round-trip (ETag=$MULTI_ETAG)" ;;
  *) printf "ETag %s is not multipart-style; aws-cli didn't exercise UploadPart\n" "$MULTI_ETAG" >&2; exit 1 ;;
esac

# Force STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER via the JS SDK. The
# aws-cli path above covers UNSIGNED-PAYLOAD-TRAILER; the signed-trailer
# variant is what clients pick when they enable default integrity *and*
# keep per-chunk signing (the AWS SDK for JavaScript does this when you
# set requestChecksumCalculation=WHEN_SUPPORTED and don't opt into
# unsigned streaming).
if command -v node >/dev/null 2>&1; then
  log "JS SDK v3 upload with signed-trailer (STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER)"
  NODE_SCRIPT="$WORK_DIR/signed-trailer.mjs"
  cat > "$NODE_SCRIPT" <<'JS'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
const [endpoint, bucket, ak, sk] = process.argv.slice(2);
const client = new S3Client({
  endpoint,
  region: 'us-east-2',
  forcePathStyle: true,
  credentials: { accessKeyId: ak, secretAccessKey: sk },
  // WHEN_SUPPORTED triggers trailing checksums; request signing is on by
  // default, so the body flows as STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER.
  requestChecksumCalculation: 'WHEN_SUPPORTED',
});
const payload = Buffer.alloc(500_000, 0x41); // 500 KiB > 64 KiB → multi-chunk
await client.send(new PutObjectCommand({
  Bucket: bucket, Key: 'signed-trailer.bin',
  Body: payload, ContentType: 'application/octet-stream',
}));
const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'signed-trailer.bin' }));
const chunks = [];
for await (const c of got.Body) chunks.push(c);
const back = Buffer.concat(chunks);
if (!back.equals(payload)) { console.error('round-trip mismatch'); process.exit(1); }
console.log('OK ' + back.length + ' bytes round-tripped');
JS
  (cd "$WORK_DIR" && npm init -y >/dev/null 2>&1 && npm install --silent --no-audit --no-fund @aws-sdk/client-s3 >/dev/null 2>&1)
  node "$NODE_SCRIPT" "$GATEWAY_URL" "$BUCKET" "$AK" "$SK"
  ok "JS SDK signed-trailer round-trip"
else
  warn "node not installed — skipping signed-trailer test"
fi

printf "\n\033[1;32mAll S3 gateway smoke checks passed.\033[0m\n"
# cleanup() via trap handles access-key revocation and bucket teardown.
