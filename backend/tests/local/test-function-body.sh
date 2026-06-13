#!/bin/bash

# Edge Function body handling test script (multipart, JSON, binary)
# Disable write rate limiting for tests
export INSFORGE_DISABLE_WRITE_RATE_LIMIT=1

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing edge function body handling (multipart/JSON/binary)..."
echo ""

API_BASE="$TEST_API_BASE"
BASE_URL="${TEST_API_BASE%/api}"
TS=$(date +%s)

echo "🔑 Getting admin token..."
ADMIN_TOKEN=$(get_admin_token)
if [ -z "$ADMIN_TOKEN" ]; then
    print_fail "Failed to get admin token"
    exit 1
fi
print_success "Got admin token"
echo ""

# Python helper for creating functions (avoids shell escaping hell)
CREATE_FUNC_PY="/tmp/create_func_$$.py"
cat > "$CREATE_FUNC_PY" << 'PYEOF'
import sys, json, urllib.request

slug = sys.argv[1]
code = sys.argv[2]
base_url = sys.argv[3]
token = sys.argv[4]

payload = json.dumps({
    "name": slug,
    "slug": slug,
    "code": code,
    "status": "active"
}).encode()

req = urllib.request.Request(
    f"{base_url}/functions",
    data=payload,
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    },
    method="POST"
)
try:
    resp = urllib.request.urlopen(req)
    print(f"Created: {slug} (status={resp.status})", file=sys.stderr)
except urllib.error.HTTPError as e:
    body = e.read().decode()
    if "already exists" in body.lower():
        print(f"Exists: {slug}", file=sys.stderr)
    else:
        print(f"FAILED: {slug} (status={e.code} body={body})", file=sys.stderr)
        sys.exit(1)
PYEOF

create_function() {
    local slug=$1
    local code=$2
    python3 "$CREATE_FUNC_PY" "$slug" "$code" "$API_BASE" "$ADMIN_TOKEN" 2>&1
    return $?
}

delete_function() {
    local slug=$1
    curl -s -X DELETE "$API_BASE/functions/$slug" \
        -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null 2>&1
}

TEST_SLUGS=()

echo "📝 Creating test functions..."

JSON_SLUG="test-json-$TS"
TEST_SLUGS+=("$JSON_SLUG")
create_function "$JSON_SLUG" \
'module.exports = async function(req) {
  const body = await req.json();
  body.received = true;
  return new Response(JSON.stringify(body), {
    headers: {"Content-Type": "application/json"}
  });
};'

MULTI_SLUG="test-multi-$TS"
TEST_SLUGS+=("$MULTI_SLUG")
create_function "$MULTI_SLUG" \
'module.exports = async function(req) {
  const ct = req.headers.get("content-type") || "";
  const parts = {};
  try {
    const form = await req.formData();
    for (const [k, v] of form.entries()) {
      if (v instanceof File) {
        const all = form.getAll(k);
        parts[k] = all.length > 1
          ? all.map(f => ({name: f.name, type: f.type, size: f.size}))
          : {name: v.name, type: v.type, size: v.size};
      } else {
        parts[k] = v;
      }
    }
    return new Response(JSON.stringify({success: true, fields: parts, contentType: ct}), {
      headers: {"Content-Type": "application/json"}
    });
  } catch (e) {
    return new Response(JSON.stringify({error: e.message, contentType: ct}), {
      status: 400,
      headers: {"Content-Type": "application/json"}
    });
  }
};'

BIN_SLUG="test-bin-$TS"
TEST_SLUGS+=("$BIN_SLUG")
create_function "$BIN_SLUG" \
'module.exports = async function(req) {
  const buf = new Uint8Array([0, 1, 2, 3, 255, 254]);
  return new Response(buf, {
    headers: {"Content-Type": "application/octet-stream"}
  });
};'

print_success "Test functions created"
echo ""
sleep 3

# ──────────────────────────────────────────────
# Test 1: JSON payload
# ──────────────────────────────────────────────
echo "──────────────────────────────────────────"
echo "Test 1: JSON payload"
echo "──────────────────────────────────────────"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/functions/$JSON_SLUG" \
    -H "Content-Type: application/json" \
    -d '{"user":"Alice","items":[1,2,3],"nested":{"key":"value"}}')
STATUS=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | sed '$d')
if [ "$STATUS" = "200" ] && echo "$BODY" | grep -q '"received":true'; then
    print_success "JSON payload"
else
    print_fail "JSON payload (status=$STATUS body=$BODY)"
fi

# ──────────────────────────────────────────────
# Test 2: Multipart text fields only
# ──────────────────────────────────────────────
echo "──────────────────────────────────────────"
echo "Test 2: Multipart text fields only"
echo "──────────────────────────────────────────"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/functions/$MULTI_SLUG" \
    -F "name=John" -F "age=30")
STATUS=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | sed '$d')
if [ "$STATUS" = "200" ] && echo "$BODY" | grep -q '"name":"John"'; then
    print_success "Multipart text fields"
else
    print_fail "Multipart text fields (status=$STATUS body=$BODY)"
fi

# ──────────────────────────────────────────────
# Test 3: Multipart text + file
# ──────────────────────────────────────────────
echo "──────────────────────────────────────────"
echo "Test 3: Multipart text + file"
echo "──────────────────────────────────────────"
echo "hello world" > /tmp/test-body-upload.txt
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/functions/$MULTI_SLUG" \
    -F "title=Report" -F "file=@/tmp/test-body-upload.txt;type=text/plain")
STATUS=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | sed '$d')
if [ "$STATUS" = "200" ] && echo "$BODY" | grep -q '"title":"Report"' && echo "$BODY" | grep -q '"size":12'; then
    print_success "Multipart text + file"
else
    print_fail "Multipart text + file (status=$STATUS body=$BODY)"
fi

# ──────────────────────────────────────────────
# Test 4: Multipart binary file
# ──────────────────────────────────────────────
echo "──────────────────────────────────────────"
echo "Test 4: Multipart binary file"
echo "──────────────────────────────────────────"
python3 -c "open('/tmp/test-body-binary.bin','wb').write(bytes(range(256)))"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/functions/$MULTI_SLUG" \
    -F "bin=@/tmp/test-body-binary.bin;type=application/octet-stream")
STATUS=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | sed '$d')
if [ "$STATUS" = "200" ] && echo "$BODY" | grep -q '"size":256'; then
    print_success "Multipart binary file (256 bytes)"
else
    print_fail "Multipart binary file (status=$STATUS body=$BODY)"
fi

# ──────────────────────────────────────────────
# Test 5: Multipart duplicate file keys
# ──────────────────────────────────────────────
echo "──────────────────────────────────────────"
echo "Test 5: Multipart duplicate file keys"
echo "──────────────────────────────────────────"
echo "aaa" > /tmp/a.txt && echo "bbb" > /tmp/b.txt
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/functions/$MULTI_SLUG" \
    -F "files=@/tmp/a.txt" -F "files=@/tmp/b.txt")
STATUS=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | sed '$d')
if [ "$STATUS" = "200" ] && echo "$BODY" | grep -q '"files":\['; then
    print_success "Multipart duplicate keys (array via getAll)"
elif [ "$STATUS" = "200" ]; then
    print_success "Multipart duplicate keys (single entry, last wins)"
else
    print_fail "Multipart duplicate keys (status=$STATUS body=$BODY)"
fi

# ──────────────────────────────────────────────
# Test 6: Empty POST body
# ──────────────────────────────────────────────
echo "──────────────────────────────────────────"
echo "Test 6: Empty POST body"
echo "──────────────────────────────────────────"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/functions/$MULTI_SLUG")
STATUS=$(echo "$RESP" | tail -n 1)
if [ "$STATUS" = "200" ] || [ "$STATUS" = "400" ]; then
    print_success "Empty body handled (status=$STATUS)"
else
    print_fail "Empty body (status=$STATUS body=$(echo "$RESP" | sed '$d'))"
fi

# ──────────────────────────────────────────────
# Test 7: Binary response
# ──────────────────────────────────────────────
echo "──────────────────────────────────────────"
echo "Test 7: Binary response"
echo "──────────────────────────────────────────"
curl -s -o /tmp/test-binary-response.bin "$BASE_URL/functions/$BIN_SLUG"
BYTES=$(wc -c < /tmp/test-binary-response.bin)
EXPECTED=$(python3 -c "print(bytes([0,1,2,3,255,254]) == open('/tmp/test-binary-response.bin','rb').read())")
if [ "$BYTES" = "6" ] && [ "$EXPECTED" = "True" ]; then
    print_success "Binary response (6 bytes, content matches)"
else
    print_fail "Binary response (bytes=$BYTES match=$EXPECTED)"
fi

# ──────────────────────────────────────────────
# Cleanup
# ──────────────────────────────────────────────
echo ""
echo "🧹 Cleaning up..."
for slug in "${TEST_SLUGS[@]}"; do
    delete_function "$slug"
done
rm -f /tmp/test-body-upload.txt /tmp/test-body-binary.bin /tmp/a.txt /tmp/b.txt /tmp/test-binary-response.bin "$CREATE_FUNC_PY"
print_success "Cleanup done"
echo ""

print_success "🎉 Function body handling tests completed!"
