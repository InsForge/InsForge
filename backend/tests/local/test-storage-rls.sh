#!/bin/bash

# E2E: Storage access is enforced by Postgres RLS, not by app-side filtering.
#
# Migration 036 ships RLS enabled with zero default policies (matching
# Supabase). This script installs an owner-only starter set via psql so
# section 1 has something to verify against — it's also the recipe a
# project would use to re-enable the pre-RLS owner-only behavior.
#
# Sections:
#   1. Owner-only RLS — Alice/Bob can't see each other's files via list,
#      get, or delete. Admin sees everything.
#   2. RLS override — drop owner SELECT policy, install a permissive one
#      ("public read inside this bucket"), verify both users now see
#      everything WITHOUT the storage service changing.
#   3. Path-based RLS — use storage.foldername(key)[1] = sub, verify
#      only files inside `<user_id>/...` are visible.
#   4. Third-party-auth-shaped JWT (text sub) flows the same path as
#      native UUID JWTs. This is what makes Better Auth / Clerk / Auth0 /
#      WorkOS / Stytch / Kinde work.
#      (Skipped if JWT_SECRET is not retrievable.)
#
# psql is required to install/teardown policies. CI installs
# postgresql-client into the backend container before running.

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
  # Use the same admin login + /metadata/api-key fallback that
  # test-public-bucket.sh uses (proven to work in CI). grep+cut over
  # python3 to avoid an extra runtime dependency on the parser.
  ADMIN_TOKEN=$(get_admin_token)
  if [ -n "$ADMIN_TOKEN" ]; then
    API_KEY_RESPONSE=$(curl -sS "$API/metadata/api-key" -H "Authorization: Bearer $ADMIN_TOKEN")
    API_KEY=$(echo "$API_KEY_RESPONSE" | grep -o '"apiKey":"[^"]*' | cut -d'"' -f4)
  fi
fi
if [ -z "$API_KEY" ] && command -v docker >/dev/null 2>&1; then
  API_KEY=$(docker logs ba-sdk-test-insforge-1 2>&1 | grep -oE 'ik_[a-f0-9]+' | tail -1 || true)
fi
if [ -z "$API_KEY" ]; then
  print_fail "Could not get API key (set TEST_API_KEY or ACCESS_API_KEY)"
  print_info "  TEST_API_BASE=$TEST_API_BASE"
  print_info "  TEST_ADMIN_EMAIL=$TEST_ADMIN_EMAIL"
  print_info "  ADMIN_TOKEN length=${#ADMIN_TOKEN}"
  print_info "  /metadata/api-key response (first 200 chars): ${API_KEY_RESPONSE:0:200}"
  exit 1
fi
# Export so the test-config.sh cleanup trap can delete buckets.
export ACCESS_API_KEY="$API_KEY"

# psql is required: migration 036 ships RLS enabled with zero default
# policies, so the test installs its own owner-only set up front.
if ! command -v psql >/dev/null 2>&1 || [ -z "$DATABASE_URL" ]; then
  print_fail "psql + DATABASE_URL required (migration 036 has no default policies)"
  exit 1
fi

PATH_BUCKET="rls-path-$TS"

# Tear down all test-installed policies on exit so a shared DB ends in
# the same state the migration left it: RLS enabled, zero policies.
cleanup_storage_policies() {
  psql "$DATABASE_URL" >/dev/null 2>&1 <<'SQL' || true
DROP POLICY IF EXISTS storage_objects_public_read_test ON storage.objects;
DROP POLICY IF EXISTS storage_objects_path_select ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_select ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_insert ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_update ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_delete ON storage.objects;
SQL
}
trap cleanup_storage_policies EXIT

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
    | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2
}

upload() {
  local jwt="$1" bucket="$2" key="$3" content="$4"
  echo "$content" > "/tmp/_rls_$TS.txt"
  # Split decl from assignment so curl's exit status isn't masked by `local`.
  local code rc
  code=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT \
    "$API/storage/buckets/$bucket/objects/$key" \
    -H "Authorization: Bearer $jwt" -F "file=@/tmp/_rls_$TS.txt")
  rc=$?
  rm -f "/tmp/_rls_$TS.txt"
  [ $rc -ne 0 ] && return $rc
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

login_token() {
  curl -sS -X POST "$API/auth/sessions" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$PASS\"}" \
    | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4
}
ALICE_JWT=$(login_token "$ALICE_EMAIL")
BOB_JWT=$(login_token "$BOB_EMAIL")

# Pull the user IDs from the JWT (sub claim) for the path-based test.
# JWT uses base64url (no padding) — decode in node since python3 isn't
# guaranteed to be installed in the backend container.
jwt_sub() {
  node -e '
    const seg = process.argv[1].split(".")[1];
    const padded = seg + "=".repeat((4 - seg.length % 4) % 4);
    const json = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    process.stdout.write(JSON.parse(json).sub);
  ' "$1"
}
ALICE_ID=$(jwt_sub "$ALICE_JWT")
BOB_ID=$(jwt_sub "$BOB_JWT")

[ -z "$ALICE_JWT" ] || [ -z "$BOB_JWT" ] && { print_fail "Login failed"; exit 1; }
print_success "Two users logged in (alice=$ALICE_ID, bob=$BOB_ID)"

# === 1. owner-only RLS =================================================

print_blue "
1. Owner-only RLS (starter policy set)"

# Install the owner-only starter set. Idempotent so the test runs the
# same way against a fresh CI DB (migration shipped no defaults) or an
# existing-project DB (migration installed the same set already).
psql "$DATABASE_URL" >/dev/null <<'SQL'
DROP POLICY IF EXISTS storage_objects_owner_select ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_insert ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_update ON storage.objects;
DROP POLICY IF EXISTS storage_objects_owner_delete ON storage.objects;
CREATE POLICY storage_objects_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (uploaded_by = (SELECT auth.jwt() ->> 'sub'));
CREATE POLICY storage_objects_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = (SELECT auth.jwt() ->> 'sub'));
CREATE POLICY storage_objects_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (uploaded_by = (SELECT auth.jwt() ->> 'sub'))
  WITH CHECK (uploaded_by = (SELECT auth.jwt() ->> 'sub'));
CREATE POLICY storage_objects_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (uploaded_by = (SELECT auth.jwt() ->> 'sub'));
SQL

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

# Anon GET on a private bucket → 401 from conditionalAuth fast path.
anon_private=$(curl -sS -o /dev/null -w "%{http_code}" \
  "$API/storage/buckets/$BUCKET/objects/a.txt")
assert_count "Anon GET private bucket → 401" "401" "$anon_private"

# === 2. override SELECT policy → public-read bucket ====================

print_blue "
2. Override owner SELECT policy → public-read"

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

# Restore the owner SELECT policy for clean teardown
psql "$DATABASE_URL" >/dev/null <<'SQL'
DROP POLICY IF EXISTS storage_objects_public_read_test ON storage.objects;
CREATE POLICY storage_objects_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (uploaded_by = (SELECT auth.jwt() ->> 'sub'));
SQL
print_success "Owner SELECT policy restored"

# === 3. path-based RLS using storage.foldername =========================

print_blue "
3. Path-based RLS (storage.foldername)"

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

# Scoped to $PATH_BUCKET so concurrent runs on other buckets aren't affected.
psql "$DATABASE_URL" >/dev/null <<SQL
DROP POLICY IF EXISTS storage_objects_owner_select ON storage.objects;
CREATE POLICY storage_objects_path_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket = '$PATH_BUCKET'
    AND (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub')
  );
SQL

assert_count "Alice list (path policy)" "1" "$(list_count "$ALICE_JWT" "$PATH_BUCKET")"
assert_count "Bob list (path policy)"   "1" "$(list_count "$BOB_JWT"   "$PATH_BUCKET")"

# Restore owner SELECT so INSERT…RETURNING against $BUCKET in section 4 sees rows.
psql "$DATABASE_URL" >/dev/null <<'SQL'
DROP POLICY IF EXISTS storage_objects_path_select ON storage.objects;
CREATE POLICY storage_objects_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (uploaded_by = (SELECT auth.jwt() ->> 'sub'));
SQL

# === 4. third-party-auth-shaped JWT (text sub) =========================

print_blue "
4. Third-party-auth-shaped sub (e.g. Better Auth)"

# Forge a BA-shaped JWT signed with the project's JWT_SECRET so we don't
# need a running BA app to prove the storage path accepts text subs.
# Order: env var (CI), then psql lookup (locally encrypted secret).
JWT_SECRET_FOR_TEST="${JWT_SECRET:-${INSFORGE_JWT_SECRET:-}}"
if [ -z "$JWT_SECRET_FOR_TEST" ]; then
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
psql "$DATABASE_URL" >/dev/null <<'SQL'
DELETE FROM storage.objects WHERE bucket LIKE 'rls-%';
DELETE FROM storage.buckets WHERE name LIKE 'rls-%';
SQL
print_success "Buckets removed (psql)"
# The trap from test-config.sh handles bucket/user cleanup via the API too.
# The cleanup_storage_policies trap drops every test-installed policy,
# leaving the table in the same RLS-enabled-no-policies state as the migration.

echo
echo "Storage RLS e2e: complete"
