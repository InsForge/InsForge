#!/bin/bash

# Auth router test script

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Source the test configuration
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing auth router..."

# Use configuration from test-config.sh
API_BASE="$TEST_API_BASE"
AUTH_TOKEN=""

http_json_request() {
    local method=$1
    local endpoint=$2
    local data=${3:-}
    local auth_token=${4:-}
    local tmp_file
    tmp_file="$(mktemp)"

    local -a curl_args=(-sS -o "$tmp_file" -w "%{http_code}" -X "$method" "$endpoint" -H "Content-Type: application/json")
    if [ -n "$auth_token" ]; then
        curl_args+=(-H "Authorization: Bearer $auth_token")
    fi
    if [ -n "$data" ]; then
        curl_args+=(-d "$data")
    fi

    local status
    status="$(curl "${curl_args[@]}")"
    local body
    body="$(cat "$tmp_file")"
    rm -f "$tmp_file"

    printf '%s\n%s' "$status" "$body"
}

assert_http_status() {
    local actual_status=$1
    local expected_status=$2
    local description=$3

    if [ "$actual_status" -ne "$expected_status" ]; then
        print_fail "$description returned status $actual_status (expected $expected_status)"
        return 1
    fi
}

json_get() {
    local json=$1
    local query=$2
    printf '%s' "$json" | jq -er "$query"
}

# Test function
# $1: method, $2: endpoint, $3: data, $4: description, $5: extra header
# If $5 is not empty, it will be added as header

test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    local extra_header=$5

    print_info "Test: $description"

    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" -X GET "$endpoint" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -H "Content-Type: application/json" $extra_header)
    elif [ "$method" = "POST" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$endpoint" \
            -H "Content-Type: application/json" $extra_header \
            -d "$data")
    fi

    body=$(echo "$response" | sed '$d')
    status=$(echo "$response" | tail -n 1)

    if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
        print_success "Success ($status)"
        echo "Response: $body" | head -c 200
        echo ""
    else
        print_fail "Failed ($status)"
        echo "Error: $body"
    fi
    echo ""
}

# 1. register new user
USER_EMAIL="${TEST_USER_EMAIL_PREFIX}$(date +%s)@example.com"
echo "USER_EMAIL: $USER_EMAIL"
USER_PASS="testpass123"
USER_NAME="${TEST_USER_EMAIL_PREFIX}$(date +%s)"

# Register user for cleanup
register_test_user "$USER_EMAIL"

echo "📝 Registering new user..."
register_response=$(curl -s -X POST "$API_BASE/auth/users" \
    -H "Content-Type: application/json" \
    -d '{"email":"'$USER_EMAIL'","password":"'$USER_PASS'","name":"'$USER_NAME'"}')

if echo "$register_response" | grep -q '"accessToken"'; then
    print_success "Register success"
    AUTH_TOKEN=$(echo "$register_response" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
else
    print_fail "Register failed"
    echo "Response: $register_response"
    track_test_failure
fi

echo ""

# 2. login with correct password
echo "🔑 Logging in with correct password..."
login_response=$(curl -s -X POST "$API_BASE/auth/sessions" \
    -H "Content-Type: application/json" \
    -d '{"email":"'$USER_EMAIL'","password":"'$USER_PASS'"}')

if echo "$login_response" | grep -q '"accessToken"'; then
    print_success "Login success"
    AUTH_TOKEN=$(echo "$login_response" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
else
    print_fail "Login failed"
    echo "Response: $login_response"
    track_test_failure
fi

echo ""

# 3. exchange an approved device authorization and verify the returned access token
echo "🪪 Exchanging an approved device authorization..."
device_create_response="$(http_json_request POST "$API_BASE/auth/device/authorizations" '{"deviceName":"router-smoke","hostname":"router-smoke","platform":"linux-x64"}')"
device_create_status="${device_create_response%%$'\n'*}"
device_create_body="${device_create_response#*$'\n'}"

if ! assert_http_status "$device_create_status" 200 "Device authorization creation"; then
    echo "Response: $device_create_body"
    track_test_failure
else
    if ! device_code="$(json_get "$device_create_body" '.deviceCode')"; then
        print_fail "Device authorization creation response missing deviceCode"
        echo "Response: $device_create_body"
        track_test_failure
    else
        if ! user_code="$(json_get "$device_create_body" '.userCode')"; then
            print_fail "Device authorization creation response missing userCode"
            echo "Response: $device_create_body"
            track_test_failure
        else
            approve_response="$(http_json_request POST "$API_BASE/auth/device/authorizations/approve" '{"userCode":"'$user_code'"}' "$AUTH_TOKEN")"
            approve_status="${approve_response%%$'\n'*}"
            approve_body="${approve_response#*$'\n'}"

            if ! assert_http_status "$approve_status" 200 "Device authorization approval"; then
                echo "Response: $approve_body"
                track_test_failure
            else
                if ! approve_status_text="$(json_get "$approve_body" '.status')"; then
                    print_fail "Device authorization approval response missing status"
                    echo "Response: $approve_body"
                    track_test_failure
                elif [ "$approve_status_text" != "approved" ]; then
                    print_fail "Device authorization approval returned unexpected status: $approve_status_text"
                    echo "Response: $approve_body"
                    track_test_failure
                else
                    device_token_response="$(http_json_request POST "$API_BASE/auth/device/token" '{"deviceCode":"'$device_code'","grantType":"urn:ietf:params:oauth:grant-type:device_code"}')"
                    device_token_status="${device_token_response%%$'\n'*}"
                    device_token_body="${device_token_response#*$'\n'}"

                    if ! assert_http_status "$device_token_status" 200 "Device authorization exchange"; then
                        echo "Response: $device_token_body"
                        track_test_failure
                    else
                        if ! device_access_token="$(json_get "$device_token_body" '.accessToken')"; then
                            print_fail "Device authorization exchange response missing accessToken"
                            echo "Response: $device_token_body"
                            track_test_failure
                        elif ! device_refresh_token="$(json_get "$device_token_body" '.refreshToken')"; then
                            print_fail "Device authorization exchange response missing refreshToken"
                            echo "Response: $device_token_body"
                            track_test_failure
                        else
                            print_success "Device authorization exchange returned access and refresh tokens"

                            repeat_token_response="$(http_json_request POST "$API_BASE/auth/device/token" '{"deviceCode":"'$device_code'","grantType":"urn:ietf:params:oauth:grant-type:device_code"}')"
                            repeat_token_status="${repeat_token_response%%$'\n'*}"
                            repeat_token_body="${repeat_token_response#*$'\n'}"

                            if ! assert_http_status "$repeat_token_status" 400 "Repeated device authorization exchange"; then
                                echo "Response: $repeat_token_body"
                                track_test_failure
                            else
                                if ! repeat_token_error="$(json_get "$repeat_token_body" '.error')"; then
                                    print_fail "Repeated device authorization response missing error"
                                    echo "Response: $repeat_token_body"
                                    track_test_failure
                                elif [ "$repeat_token_error" != "already_used" ]; then
                                    print_fail "Repeated device authorization returned unexpected error: $repeat_token_error"
                                    echo "Response: $repeat_token_body"
                                    track_test_failure
                                else
                                    print_success "Repeated device authorization exchange failed as expected"
                                fi
                            fi

                            device_me_response="$(http_json_request GET "$API_BASE/auth/sessions/current" "" "$device_access_token")"
                            device_me_status="${device_me_response%%$'\n'*}"
                            device_me_body="${device_me_response#*$'\n'}"

                            if ! assert_http_status "$device_me_status" 200 "Device access token session lookup"; then
                                echo "Response: $device_me_body"
                                track_test_failure
                            else
                                if ! device_me_email="$(printf '%s' "$device_me_body" | jq -er --arg email "$USER_EMAIL" '.user.email == $email')"; then
                                    print_fail "Device access token session response missing user.email"
                                    echo "Response: $device_me_body"
                                    track_test_failure
                                elif [ "$device_me_email" != "true" ]; then
                                    print_fail "Device access token session returned the wrong user email"
                                    echo "Response: $device_me_body"
                                    track_test_failure
                                else
                                    print_success "Device access token can read the current session"
                                    echo "Response: $device_me_body" | head -c 200
                                    echo ""
                                fi
                            fi
                        fi
                    fi
                fi
            fi
        fi
    fi
fi

echo ""

# 4. login with wrong password
echo "🔒 Logging in with wrong password..."
wrong_login_response=$(curl -s -X POST "$API_BASE/auth/sessions" \
    -H "Content-Type: application/json" \
    -d '{"email":"'$USER_EMAIL'","password":"wrongpass"}')

if echo "$wrong_login_response" | grep -q '"Invalid credentials"'; then
    print_success "Wrong password login failed as expected"
else
    print_fail "Wrong password login did not fail"
    echo "Response: $wrong_login_response"
    track_test_failure
fi

echo ""

# 5. register with duplicate email
echo "📝 Registering with duplicate email..."
duplicate_register_response=$(curl -s -X POST "$API_BASE/auth/users" \
    -H "Content-Type: application/json" \
    -d '{"email":"'$USER_EMAIL'","password":"'$USER_PASS'","name":"'$USER_NAME' duplicate"}')

if echo "$duplicate_register_response" | grep -q '"User already exists"'; then
    print_success "Duplicate register failed as expected"
else
    print_fail "Duplicate register did not fail"
    echo "Response: $duplicate_register_response"
    track_test_failure
fi

echo ""

# 6. get current user info
echo "👤 Getting current user info..."
me_response=$(curl -s -X GET "$API_BASE/auth/sessions/current" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json")

if echo "$me_response" | grep -q '"id"' && echo "$me_response" | grep -q '"email"'; then
    print_success "Get current user info success"
    echo "Response: $me_response" | head -c 200
    echo ""
else
    print_fail "Get current user info failed"
    echo "Response: $me_response"
    track_test_failure
fi

print_success "🎉 Auth router test completed!"
