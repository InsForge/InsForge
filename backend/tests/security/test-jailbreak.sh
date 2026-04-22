#!/bin/bash

# Security Jailbreak Test Suite for InsForge Sandbox
# Verifies that RCE, Exfiltration, and Fingerprinting are blocked.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../test-config.sh"

API_BASE="${TEST_API_BASE:-http://localhost:7130/api}"
DENO_BASE="${DENO_BASE:-http://localhost:7133}"

print_blue "🛡️ Starting Security Jailbreak Audit..."

# Get admin token
ADMIN_TOKEN=$(get_admin_token)
if [ -z "$ADMIN_TOKEN" ]; then
    print_fail "Failed to get admin token"
    exit 1
fi

test_jailbreak() {
    local name="$1"
    local code="$2"
    local expected_error="$3"

    print_info "Testing $name..."
    
    # Try to create the function
    response=$(curl -s -X POST "$API_BASE/functions" \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"slug\": \"jailbreak-$RANDOM\",
            \"name\": \"Jailbreak Test\",
            \"code\": $(jq -Rs . <<< "$code"),
            \"status\": \"active\"
        }")

    # If it's blocked by the Regex (Tier 1)
    if echo "$response" | grep -q "potentially dangerous pattern"; then
        print_success "PASSED: Blocked by Tier 1 (Regex Filtering)"
        return
    fi

    # If it was created, try to execute it to check Tier 2/3
    local slug=$(echo "$response" | jq -r '.function.slug')
    if [ "$slug" != "null" ] && [ -n "$slug" ]; then
        exec_response=$(curl -s "$DENO_BASE/$slug")
        
        # Cleanup
        curl -s -X DELETE "$API_BASE/functions/$slug" -H "Authorization: Bearer $ADMIN_TOKEN" >/dev/null

        if echo "$exec_response" | grep -q "$expected_error" || echo "$exec_response" | grep -q "Worker execution error"; then
            print_success "PASSED: Blocked by Tier 2/3 (Sandbox/Permission Isolation)"
        else
            print_fail "FAILED: Jailbreak succeeded! Response: $exec_response"
            exit 1
        fi
    else
        print_fail "FAILED: Unexpected error during function creation: $response"
        exit 1
    fi
}

# --- TEST CASES ---

# 1. RCE via Subprocess
test_jailbreak "RCE via Deno.Command" \
"module.exports = async () => { return new Deno.Command('ls').output(); }" \
"potentially dangerous pattern"

# 2. Data Exfiltration via External Net
test_jailbreak "External Network Egress" \
"module.exports = async () => { return await fetch('https://google.com'); }" \
"Requires net access"

# 3. Secret Enumeration via Env
test_jailbreak "Environment Enumeration" \
"module.exports = async () => { return new Response(JSON.stringify(Deno.env.toObject())); }" \
"is not a function"

# 4. Dynamic Execution via Function constructor
test_jailbreak "Dynamic Function Creation" \
"module.exports = async () => { const f = new Function('return 1'); return f(); }" \
"potentially dangerous pattern"

print_success "🏆 All Security Jailbreak Tests Passed! Sandbox is Hardened."
