#!/bin/bash

# Verifies that storage access is enforced by Postgres RLS, not by app-side
# filtering. Two users should only see their own uploads via list/get/delete;
# admin should see everything; native InsForge auth should still work
# (UUID `sub` continues to be valid `text`).

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

API="$TEST_API_BASE"
TS=$(date +%s)
BUCKET="rls-test-$TS"
ALICE_EMAIL="alice-rls-$TS@example.com"
BOB_EMAIL="bob-rls-$TS@example.com"
PASS="testpass123"

ALICE_FILE="alice-note-$TS.txt"
BOB_FILE="bob-note-$TS.txt"

register_test_bucket "$BUCKET"

echo "🧪 Storage RLS isolation"
echo "========================"

# Admin setup: get API key + create the bucket
admin_token=$(get_admin_token)
api_key=$(get_admin_api_key)
if [ -z "$api_key" ] && [ -n "$admin_token" ]; then
  api_key=$(curl -s "$API/metadata/api-key" -H "Authorization: Bearer $admin_token" \
            | grep -o '"apiKey":"[^"]*' | cut -d'"' -f4)
fi
[ -z "$api_key" ] && { print_fail "Could not get API key"; exit 1; }

curl -s -X POST "$API/storage/buckets" \
  -H "Authorization: Bearer $api_key" -H "Content-Type: application/json" \
  -d "{\"bucketName\":\"$BUCKET\",\"isPublic\":false}" > /dev/null
print_success "Bucket created: $BUCKET"

# Register two users via the InsForge native auth endpoint
register_user "$ALICE_EMAIL" "$PASS" "Alice" > /dev/null
register_user "$BOB_EMAIL" "$PASS"   "Bob"   > /dev/null

alice_resp=$(login_user "$ALICE_EMAIL" "$PASS")
bob_resp=$(login_user "$BOB_EMAIL"     "$PASS")
alice_jwt=$(echo "$alice_resp" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
bob_jwt=$(echo "$bob_resp"     | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
[ -z "$alice_jwt" ] || [ -z "$bob_jwt" ] && { print_fail "Could not log in users"; exit 1; }
print_success "Two users logged in"

# Alice and Bob each upload one file
echo "alice-content" > /tmp/alice-rls-$TS.txt
echo "bob-content"   > /tmp/bob-rls-$TS.txt
alice_up=$(curl -s -w "\n%{http_code}" -X PUT \
  "$API/storage/buckets/$BUCKET/objects/$ALICE_FILE" \
  -H "Authorization: Bearer $alice_jwt" \
  -F "file=@/tmp/alice-rls-$TS.txt")
[ "$(echo "$alice_up" | tail -1)" != "201" ] && { print_fail "Alice upload failed"; exit 1; }
print_success "Alice uploaded $ALICE_FILE"

bob_up=$(curl -s -w "\n%{http_code}" -X PUT \
  "$API/storage/buckets/$BUCKET/objects/$BOB_FILE" \
  -H "Authorization: Bearer $bob_jwt" \
  -F "file=@/tmp/bob-rls-$TS.txt")
[ "$(echo "$bob_up" | tail -1)" != "201" ] && { print_fail "Bob upload failed"; exit 1; }
print_success "Bob uploaded $BOB_FILE"

# RLS check 1: Alice's list contains only Alice's file
alice_list=$(curl -s "$API/storage/buckets/$BUCKET/objects" \
  -H "Authorization: Bearer $alice_jwt")
if echo "$alice_list" | grep -q "$ALICE_FILE" \
   && ! echo "$alice_list" | grep -q "$BOB_FILE"; then
  print_success "Alice's list shows only her file"
else
  print_fail "Alice's list leaked Bob's file or hid hers: $alice_list"
fi

# RLS check 2: Bob's list contains only Bob's file
bob_list=$(curl -s "$API/storage/buckets/$BUCKET/objects" \
  -H "Authorization: Bearer $bob_jwt")
if echo "$bob_list" | grep -q "$BOB_FILE" \
   && ! echo "$bob_list" | grep -q "$ALICE_FILE"; then
  print_success "Bob's list shows only his file"
else
  print_fail "Bob's list leaked Alice's file or hid his: $bob_list"
fi

# RLS check 3: Bob cannot DELETE Alice's file (should 404)
bob_delete=$(curl -s -w "\n%{http_code}" -X DELETE \
  "$API/storage/buckets/$BUCKET/objects/$ALICE_FILE" \
  -H "Authorization: Bearer $bob_jwt")
status=$(echo "$bob_delete" | tail -1)
if [ "$status" = "404" ]; then
  print_success "Bob's DELETE of Alice's file rejected (404 — RLS blocked)"
else
  print_fail "Bob's DELETE returned $status (expected 404)"
fi

# Confirm Alice's file is still there after Bob's attempt
alice_recheck=$(curl -s "$API/storage/buckets/$BUCKET/objects" \
  -H "Authorization: Bearer $alice_jwt")
if echo "$alice_recheck" | grep -q "$ALICE_FILE"; then
  print_success "Alice's file survived Bob's delete attempt"
else
  print_fail "Alice's file disappeared — RLS DELETE policy is leaking"
fi

# Admin sees both files
admin_list=$(curl -s "$API/storage/buckets/$BUCKET/objects" \
  -H "Authorization: Bearer $api_key")
if echo "$admin_list" | grep -q "$ALICE_FILE" \
   && echo "$admin_list" | grep -q "$BOB_FILE"; then
  print_success "Admin sees both Alice's and Bob's files"
else
  print_fail "Admin missing files: $admin_list"
fi

# Owner can DELETE her own file
alice_delete=$(curl -s -w "\n%{http_code}" -X DELETE \
  "$API/storage/buckets/$BUCKET/objects/$ALICE_FILE" \
  -H "Authorization: Bearer $alice_jwt")
[ "$(echo "$alice_delete" | tail -1)" = "200" ] \
  && print_success "Alice deleted her own file" \
  || print_fail "Alice's self-delete returned $(echo "$alice_delete" | tail -1)"

# Cleanup
rm -f /tmp/alice-rls-$TS.txt /tmp/bob-rls-$TS.txt

echo
echo "Storage RLS test complete"
