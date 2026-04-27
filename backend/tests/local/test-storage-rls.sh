#!/bin/bash

# E2E: Storage access is enforced by Postgres RLS, not by app-side filtering.
#
# Sections:
#   1. Default owner-only RLS — Alice/Bob can't see each other's files
#      via list, get, or delete. Admin sees everything. (Always runs.)
#   2. RLS override — drop default SELECT policy, install a permissive
#      one ("public read inside this bucket"), verify both users now see
#      everything WITHOUT the storage service changing.
#      (Skipped if psql is unavailable or DATABASE_URL is unset.)
#   3. Path-based RLS — use storage.foldername(key)[1] = sub, verify
#      only files inside `<user_id>/...` are visible.
#      (Skipped if psql is unavailable.)
#   4. Third-party-auth-shaped JWT (text sub) flows the same path as
#      native UUID JWTs. This is what makes Better Auth / Clerk / Auth0 /
#      WorkOS / Stytch / Kinde work.
#      (Skipped if JWT_SECRET is not retrievable.)
#
# Section 1 covers the core acceptance criterion (RLS-driven isolation).
# The other sections add stronger evidence when psql + JWT_SECRET are
# available locally, but their absence does not fail the suite — CI runs
# inside a backend container that lacks the psql client.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

API="${TEST_API_BASE:-http://localhost:7130/api}"
TS=$(date +%s)
PASS="testpass123"

ALICE_EMAIL="alice-rls-$TS@example.com"
BOB_EMAIL="bob-rls-$TS@example.com"

# === helpers ============================================================

# Pull an admin API key. Order:
#   1. TEST_API_KEY / ACCESS_API_KEY env (CI sets one of these)
#   2. Admin login → GET /api/metadata/api-key (works against any deployment)
#   3. Local-dev fallback: scrape ik_… from a known container's logs
API_KEY="${TEST_API_KEY:-${ACCESS_API_KEY:-}}"
if [ -z "$API_KEY" ]; then
  ADMIN_TOKEN=$(get_admin_token 2>/dev/null || true)
  if [ -n "$ADMIN_TOKEN" ]; then
    API_KEY=$(curl -sS "$API/metadata/api-key" -H "Authorization: Bearer $ADMIN_TOKEN" \
      | python3 -c 'import sys,json; print(json.load(sys.stdin).get("apiKey",""))' 2>/dev/null || true)
  fi
fi
if [ -z "$API_KEY" ] && command -v docker >/dev/null 2>&1; then
  API_KEY=$(docker logs ba-sdk-test-insforge-1 2>&1 | grep -oE 'ik_[a-f0-9]+' | tail -1 || true)
fi
[ -z "$API_KEY" ] && { print_fail "Could not get API key (set TEST_API_KEY or ACCESS_API_KEY)"; exit 1; }
# Export so the test-config.sh cleanup trap can delete buckets.
export ACCESS_API_KEY="$API_KEY"

# psql + DATABASE_URL gate sections 2 and 3.
HAVE_PSQL=0
if command -v psql >/dev/null 2>&1 && [ -n "$DATABASE_URL" ]; then
  HAVE_PSQL=1
fi

assert_count() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    print_success "$label = $actual"
  else
    print_fail "$label expected $expected got $actual"
  fi
}

list_count() {
  local jwt="$1" bucket="$2"
  curl -sS "$API/storage/buckets/$bucket/objects" -H "Authorization: Bearer $jwt" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["pagination"]["total"])'
}

upload() {
  local jwt="$1" bucket="$2" key="$3" content="$4"
  echo "$content" > /tmp/_rls_$TS.txt
  local code=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT \
    "$API/storage/buckets/$bucket/objects/$key" \
    -H "Authorization: Bearer $jwt" -F "file=@/tmp/_rls_$TS.txt")
  rm -f /tmp/_rls_$TS.txt
  echo "$code"
}

# === setup ==============================================================

BUCKET="rls-test-$TS"
register_test_bucket "$BUCKET"

curl -sS -X POST "$API/storage/buckets" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d "{\"bucketName\":\"$BUCKET\",\"isPublic\":false}" > /dev/null
print_success "Bucket created: $BUCKET"

curl -sS -X POST "$API/auth/users" -H "Content-Type: application/json" \
  -d "{\"email\":\"$ALICE_EMAIL\",\"password\":\"$PASS\",\"name\":\"Alice\"}" > /dev/null
curl -sS -X POST "$API/auth/users" -H "Content-Type: application/json" \
  -d "{\"email\":\"$BOB_EMAIL\",\"password\":\"$PASS\",\"name\":\"Bob\"}" > /dev/null
register_test_user "$ALICE_EMAIL"
register_test_user "$BOB_EMAIL"

ALICE_JWT=$(curl -sS -X POST "$API/auth/sessions" -H "Content-Type: application/json" \
  -d "{\"email\":\"$ALICE_EMAIL\",\"password\":\"$PASS\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')
BOB_JWT=$(curl -sS -X POST "$API/auth/sessions" -H "Content-Type: application/json" \
  -d "{\"email\":\"$BOB_EMAIL\",\"password\":\"$PASS\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')

# Pull the user IDs from the JWT (sub claim) for the path-based test.
# JWT uses base64url (no padding) — decode in python3 with urlsafe_b64decode.
jwt_sub() {
  python3 -c "
import sys, json, base64
seg = sys.argv[1].split('.')[1]
seg += '=' * (-len(seg) % 4)
print(json.loads(base64.urlsafe_b64decode(seg))['sub'])
" "$1"
}
ALICE_ID=$(jwt_sub "$ALICE_JWT")
BOB_ID=$(jwt_sub "$BOB_JWT")

[ -z "$ALICE_JWT" ] || [ -z "$BOB_JWT" ] && { print_fail "Login failed"; exit 1; }
print_success "Two users logged in (alice=$ALICE_ID, bob=$BOB_ID)"

# === 1. default owner-only RLS =========================================

print_blue "
1. Default owner-only RLS"

assert_count "Alice upload"  "201" "$(upload "$ALICE_JWT" "$BUCKET" "a.txt" alice)"
assert_count "Bob upload"    "201" "$(upload "$BOB_JWT"   "$BUCKET" "b.txt" bob)"

assert_count "Alice list"  "1" "$(list_count "$ALICE_JWT" "$BUCKET")"
assert_count "Bob list"    "1" "$(list_count "$BOB_JWT"   "$BUCKET")"
assert_count "Admin list"  "2" "$(list_count "$API_KEY"   "$BUCKET")"

bob_get_alice=$(curl -sS -o /dev/null -w "%{http_code}" \
  "$API/storage/buckets/$BUCKET/objects/a.txt" -H "Authorization: Bearer $BOB_JWT")
assert_count "Bob GET alice's file (RLS hides → 404)" "404" "$bob_get_alice"

bob_del_alice=$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE \
  "$API/storage/buckets/$BUCKET/objects/a.txt" -H "Authorization: Bearer $BOB_JWT")
assert_count "Bob DELETE alice's file (RLS blocks → 404)" "404" "$bob_del_alice"

assert_count "Alice's file survived" "1" "$(list_count "$ALICE_JWT" "$BUCKET")"

# === 2. override SELECT policy → public-read bucket ====================

if [ "$HAVE_PSQL" = "1" ]; then
  print_blue "
2. Override default SELECT policy → public-read"

  psql "$DATABASE_URL" >/dev/null <<SQL
DROP POLICY IF EXISTS storage_objects_owner_select ON storage.objects;
CREATE POLICY storage_objects_public_read_test ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket = '$BUCKET');
SQL

  # Without the storage service changing, Alice and Bob should now see both files.
  assert_count "Alice list (after override)" "2" "$(list_count "$ALICE_JWT" "$BUCKET")"
  assert_count "Bob list (after override)"   "2" "$(list_count "$BOB_JWT"   "$BUCKET")"

  # But INSERT/DELETE policies are unchanged — Bob still can't delete Alice's file
  bob_del_alice2=$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE \
    "$API/storage/buckets/$BUCKET/objects/a.txt" -H "Authorization: Bearer $BOB_JWT")
  assert_count "Bob DELETE alice's file (DELETE policy unchanged)" "404" "$bob_del_alice2"

  # Restore the default policy
  psql "$DATABASE_URL" >/dev/null <<SQL
DROP POLICY IF EXISTS storage_objects_public_read_test ON storage.objects;
CREATE POLICY storage_objects_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (uploaded_by = current_setting('request.jwt.claim.sub', true));
SQL
  print_success "Default SELECT policy restored"
else
  print_info "2. Override SELECT policy: SKIPPED (psql or DATABASE_URL not available)"
fi

# === 3. path-based RLS using storage.foldername =========================

if [ "$HAVE_PSQL" = "1" ]; then
  print_blue "
3. Path-based RLS (storage.foldername)"

  PATH_BUCKET="rls-path-$TS"
  register_test_bucket "$PATH_BUCKET"
  curl -sS -X POST "$API/storage/buckets" \
    -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
    -d "{\"bucketName\":\"$PATH_BUCKET\",\"isPublic\":false}" > /dev/null

  # Each user uploads at <user_id>/note.txt — column-based RLS still applies, so
  # this works.
  assert_count "Alice upload alice/note" "201" \
    "$(upload "$ALICE_JWT" "$PATH_BUCKET" "${ALICE_ID}/note.txt" alice)"
  assert_count "Bob upload bob/note"     "201" \
    "$(upload "$BOB_JWT"   "$PATH_BUCKET" "${BOB_ID}/note.txt" bob)"

  # Now layer a path-based policy and verify the helper works in production
  psql "$DATABASE_URL" >/dev/null <<SQL
DROP POLICY IF EXISTS storage_objects_owner_select ON storage.objects;
CREATE POLICY storage_objects_path_select ON storage.objects
  FOR SELECT TO authenticated
  USING ((storage.foldername(key))[1] = current_setting('request.jwt.claim.sub', true));
SQL

  assert_count "Alice list (path policy)" "1" "$(list_count "$ALICE_JWT" "$PATH_BUCKET")"
  assert_count "Bob list (path policy)"   "1" "$(list_count "$BOB_JWT"   "$PATH_BUCKET")"

  # Restore default
  psql "$DATABASE_URL" >/dev/null <<SQL
DROP POLICY IF EXISTS storage_objects_path_select ON storage.objects;
CREATE POLICY storage_objects_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (uploaded_by = current_setting('request.jwt.claim.sub', true));
SQL
  print_success "Default policy restored after path-based test"
else
  print_info "3. Path-based RLS: SKIPPED (psql or DATABASE_URL not available)"
fi

# === 4. third-party-auth-shaped JWT (text sub) =========================

print_blue "
4. Third-party-auth-shaped sub (e.g. Better Auth)"

# Forge a BA-shaped JWT signed with the project's JWT_SECRET so we don't
# need a running BA app to prove the storage path accepts text subs.
# Order: env var (CI), then psql lookup if available (locally encrypted secret).
JWT_SECRET_FOR_TEST="${JWT_SECRET:-${INSFORGE_JWT_SECRET:-}}"
if [ -z "$JWT_SECRET_FOR_TEST" ] && [ "$HAVE_PSQL" = "1" ]; then
  JWT_SECRET_FOR_TEST=$(psql "$DATABASE_URL" -t -A -c \
    "SELECT system.decrypt_secret(value_ciphertext) FROM system.secrets WHERE key='JWT_SECRET' LIMIT 1;" 2>/dev/null || true)
fi

if [ -n "$JWT_SECRET_FOR_TEST" ] && command -v node >/dev/null 2>&1; then
  # Sign HS256 with Node's built-in crypto module — no jsonwebtoken dependency.
  BA_SUB="ZVP5j6raUC9cuBIWzDGjdNdelMFjWNc5"
  BA_JWT=$(BA_SUB="$BA_SUB" JWT_SECRET="$JWT_SECRET_FOR_TEST" node -e '
    const c = require("crypto");
    const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    const now = Math.floor(Date.now() / 1000);
    const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = b64u(JSON.stringify({
      sub: process.env.BA_SUB,
      role: "authenticated",
      aud: "insforge-api",
      email: "ba@example.com",
      iat: now, exp: now + 300,
    }));
    const sig = b64u(c.createHmac("sha256", process.env.JWT_SECRET).update(header + "." + payload).digest());
    console.log(header + "." + payload + "." + sig);
  ' 2>/dev/null || true)

  if [ -n "$BA_JWT" ]; then
    assert_count "BA-shaped upload" "201" \
      "$(upload "$BA_JWT" "$BUCKET" "ba-note-$TS.txt" "ba content")"
    # BA user only sees their own file (column-based RLS still works for text sub)
    ba_count=$(list_count "$BA_JWT" "$BUCKET")
    assert_count "BA-shaped list (1 own file)" "1" "$ba_count"
  else
    print_info "Skipped: failed to forge test JWT (node crypto unavailable?)"
  fi
else
  print_info "Skipped: JWT_SECRET not retrievable from this environment"
fi

# === cleanup ============================================================

print_blue "
Cleanup"
if [ "$HAVE_PSQL" = "1" ]; then
  psql "$DATABASE_URL" >/dev/null <<SQL
DELETE FROM storage.objects WHERE bucket LIKE 'rls-%';
DELETE FROM storage.buckets WHERE name LIKE 'rls-%';
SQL
  print_success "Buckets removed (psql)"
fi
# The trap from test-config.sh handles bucket/user cleanup via the API too.

echo
echo "Storage RLS e2e: complete"
