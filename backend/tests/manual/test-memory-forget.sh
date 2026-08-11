#!/bin/bash

# Agent memory forget test script
# Tests the /api/memory/forget endpoint
#
# Manual rather than automated: seeding memories goes through /api/memory/remember,
# which embeds each candidate and runs the reconcile completion, so a run spends
# real OpenRouter calls. Same reason test-ai-embeddings.sh lives here.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing agent memory forget endpoint..."

API_BASE="$TEST_API_BASE"
SCOPE_A="test-forget-a-$$"
SCOPE_B="test-forget-b-$$"
GHOST_ID="99999999-9999-4999-8999-999999999999"

# The memory routes are behind verifyApiKey, not admin JWT.
echo "🔑 Getting API key..."
api_key=$(get_admin_api_key)

if [ -z "$api_key" ]; then
    admin_token=$(get_admin_token)
    if [ -n "$admin_token" ]; then
        api_key_response=$(curl -s "$API_BASE/metadata/api-key" \
            -H "Authorization: Bearer $admin_token")
        api_key=$(echo "$api_key_response" | grep -o '"apiKey":"[^"]*' | cut -d'"' -f4 || true)
    fi
fi

if [ -z "$api_key" ]; then
    print_fail "Could not get an API key (set ACCESS_API_KEY, or configure root admin credentials)"
    exit_with_status
fi
print_success "Got API key"
echo ""

# Helpers ---------------------------------------------------------------------

# memory_post <endpoint> <json> -> body on stdout
memory_post() {
    curl -s -X POST "$API_BASE/memory/$1" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        -d "$2"
}

# memory_status <endpoint> <json> -> http status on stdout
memory_status() {
    curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/memory/$1" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        -d "$2"
}

remember_one() {
    memory_post remember \
        "{\"scope\":\"$1\",\"kind\":\"$2\",\"title\":\"$3\",\"content\":\"$4\"}"
}

# ids_in_scope <scope> -> newline-separated ids
ids_in_scope() {
    memory_post index "{\"scope\":\"$1\"}" \
        | grep -o '"id":"[^"]*' | cut -d'"' -f4 || true
}

count_in_scope() {
    ids_in_scope "$1" | grep -c . || true
}

# Seed ------------------------------------------------------------------------

echo "🌱 Seeding memories in two scopes..."
seed_response=$(remember_one "$SCOPE_A" "fact" "pg port" \
    "The local InsForge Postgres listens on host port 5432.")

if ! echo "$seed_response" | grep -q '"results"'; then
    print_fail "Could not seed a memory via /api/memory/remember"
    echo "Response: $seed_response"
    print_info "remember needs an embedding model — on self-host, set OPENROUTER_API_KEY."
    exit_with_status
fi

remember_one "$SCOPE_A" "decision" "rrf k" \
    "Recall fuses the vector and keyword arms with RRF at k=60." > /dev/null
remember_one "$SCOPE_A" "reference" "stale fact" \
    "The job queue for this project runs on Redis." > /dev/null
remember_one "$SCOPE_B" "fact" "other scope" \
    "This memory belongs to a different scope entirely." > /dev/null

seeded_a=$(count_in_scope "$SCOPE_A")
if [ "$seeded_a" -eq 3 ]; then
    print_success "Seeded 3 memories in scope A"
else
    print_fail "Expected 3 memories in scope A, got $seeded_a"
    exit_with_status
fi

victim_id=$(ids_in_scope "$SCOPE_A" | sed -n '1p')
id_b=$(ids_in_scope "$SCOPE_B" | sed -n '1p')
echo ""

# 1. The scope guard ----------------------------------------------------------

echo "📊 Test 1: an id from another scope must not be deleted..."
cross_response=$(memory_post forget "{\"scope\":\"$SCOPE_A\",\"ids\":[\"$id_b\"]}")

if echo "$cross_response" | grep -q '"forgotten":\[\]'; then
    print_success "Cross-scope delete forgot nothing"
else
    print_fail "Cross-scope delete returned something"
    echo "Response: $cross_response"
fi

survivors_b=$(count_in_scope "$SCOPE_B")
if [ "$survivors_b" -eq 1 ]; then
    print_success "Scope B's memory survived"
else
    print_fail "Scope B's memory was deleted from another scope (count: $survivors_b)"
fi
echo ""

# 2. Unknown ids --------------------------------------------------------------

echo "📊 Test 2: an unknown id is absent rather than an error..."
status=$(memory_status forget "{\"scope\":\"$SCOPE_A\",\"ids\":[\"$GHOST_ID\"]}")
ghost_response=$(memory_post forget "{\"scope\":\"$SCOPE_A\",\"ids\":[\"$GHOST_ID\"]}")

if [ "$status" -eq 200 ]; then
    print_success "Unknown id returned 200"
else
    print_fail "Expected 200 for an unknown id, got $status"
fi

if echo "$ghost_response" | grep -q '"forgotten":\[\]'; then
    print_success "Unknown id reported as forgotten nothing"
else
    print_fail "Unknown id did not come back empty"
    echo "Response: $ghost_response"
fi
echo ""

# 3. A real delete ------------------------------------------------------------

echo "📊 Test 3: deletes in scope and echoes only what it removed..."
mixed_response=$(memory_post forget \
    "{\"scope\":\"$SCOPE_A\",\"ids\":[\"$victim_id\",\"$GHOST_ID\"]}")

if echo "$mixed_response" | grep -q "\"$victim_id\"" && \
   ! echo "$mixed_response" | grep -q "$GHOST_ID"; then
    print_success "Echoed the real id and not the ghost"
else
    print_fail "Unexpected forgotten list"
    echo "Response: $mixed_response"
fi

remaining_a=$(count_in_scope "$SCOPE_A")
if [ "$remaining_a" -eq 2 ]; then
    print_success "Scope A down to 2 memories"
else
    print_fail "Expected 2 memories left in scope A, got $remaining_a"
fi
echo ""

# 4. Idempotency --------------------------------------------------------------

echo "📊 Test 4: repeating the same delete is a no-op..."
repeat_status=$(memory_status forget "{\"scope\":\"$SCOPE_A\",\"ids\":[\"$victim_id\"]}")
repeat_response=$(memory_post forget "{\"scope\":\"$SCOPE_A\",\"ids\":[\"$victim_id\"]}")

if [ "$repeat_status" -eq 200 ] && echo "$repeat_response" | grep -q '"forgotten":\[\]'; then
    print_success "Repeated delete returned 200 and forgot nothing"
else
    print_fail "Repeated delete was not a no-op (status: $repeat_status)"
    echo "Response: $repeat_response"
fi
echo ""

# 5. The memory is really gone from recall ------------------------------------

echo "📊 Test 5: a forgotten memory no longer comes back from recall..."
# threshold 1.0 is unsatisfiable for cosine similarity, so this exercises the
# keyword arm alone — the arm that would still match the deleted row's tokens.
recall_response=$(memory_post recall \
    "{\"scope\":\"$SCOPE_A\",\"query\":\"Redis job queue\",\"limit\":5,\"threshold\":1.0}")

if echo "$recall_response" | grep -q "Redis"; then
    print_fail "Recall still returns the forgotten memory"
    echo "Response: $recall_response"
else
    print_success "Recall no longer returns it"
fi
echo ""

# 6. Validation ---------------------------------------------------------------

echo "📊 Test 6: request validation..."
bad_uuid_status=$(memory_status forget "{\"scope\":\"$SCOPE_A\",\"ids\":[\"not-a-uuid\"]}")
if [ "$bad_uuid_status" -eq 400 ]; then
    print_success "Non-uuid id rejected with 400"
else
    print_fail "Expected 400 for a non-uuid id, got $bad_uuid_status"
fi

empty_status=$(memory_status forget "{\"scope\":\"$SCOPE_A\",\"ids\":[]}")
if [ "$empty_status" -eq 400 ]; then
    print_success "Empty id list rejected with 400"
else
    print_fail "Expected 400 for an empty id list, got $empty_status"
fi

missing_status=$(memory_status forget "{\"scope\":\"$SCOPE_A\"}")
if [ "$missing_status" -eq 400 ]; then
    print_success "Missing ids rejected with 400"
else
    print_fail "Expected 400 when ids is missing, got $missing_status"
fi
echo ""

# 7. Auth ---------------------------------------------------------------------

echo "📊 Test 7: the endpoint requires an API key..."
noauth_status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/memory/forget" \
    -H "Content-Type: application/json" \
    -d "{\"scope\":\"$SCOPE_A\",\"ids\":[\"$GHOST_ID\"]}")

if [ "$noauth_status" -eq 401 ]; then
    print_success "Request without an API key returned 401 as expected"
else
    print_fail "Expected 401 for an unauthenticated request, got $noauth_status"
fi
echo ""

# Cleanup ---------------------------------------------------------------------

echo "🧹 Removing the seeded memories..."
for scope in "$SCOPE_A" "$SCOPE_B"; do
    remaining=$(ids_in_scope "$scope" | sed 's/.*/"&"/' | paste -sd, - || true)
    if [ -n "$remaining" ]; then
        memory_post forget "{\"scope\":\"$scope\",\"ids\":[$remaining]}" > /dev/null
    fi
    left=$(count_in_scope "$scope")
    if [ "$left" -eq 0 ]; then
        print_success "Scope $scope emptied"
    else
        print_fail "Scope $scope still holds $left memories — remove them manually"
    fi
done
echo ""

print_success "🎉 Agent memory forget test completed!"
exit_with_status
