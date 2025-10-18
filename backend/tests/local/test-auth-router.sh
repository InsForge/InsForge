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

    body=$(echo "$response" | head -n -1)
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

# 3. login with wrong password
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

# 4. register with duplicate email
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

# 5. get current user info
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

echo ""

# 6. get admin password (development mode only)
echo "🔑 Getting admin password from backend..."
admin_pwd_response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/auth/admin-password" \
    -H "Content-Type: application/json")

admin_pwd_body=$(echo "$admin_pwd_response" | sed '$d')
admin_pwd_status=$(echo "$admin_pwd_response" | tail -n 1)

if [ "$admin_pwd_status" -eq 200 ]; then
    if echo "$admin_pwd_body" | grep -q '"password"'; then
        fetched_password=$(echo "$admin_pwd_body" | grep -o '"password":"[^"]*"' | cut -d'"' -f4)
        print_success "Admin password fetched successfully"
        echo "Password: $fetched_password"

        # 7. Test admin login with fetched password
        echo ""
        echo "🔐 Testing admin login with fetched password..."
        admin_login_response=$(curl -s -X POST "$API_BASE/auth/admin/sessions" \
            -H "Content-Type: application/json" \
            -d '{"email":"'"$TEST_ADMIN_EMAIL"'","password":"'"$fetched_password"'"}')

        if echo "$admin_login_response" | grep -q '"accessToken"'; then
            print_success "Admin login successful with fetched password"
        else
            print_fail "Admin login failed with fetched password"
            echo "Response: $admin_login_response"
            track_test_failure
        fi
    else
        print_fail "Admin password response missing 'password' field"
        echo "Response: $admin_pwd_body"
        track_test_failure
    fi
elif [ "$admin_pwd_status" -eq 404 ]; then
    print_info "Admin password endpoint returned 404 (expected in production mode)"
else
    print_fail "Admin password endpoint failed (Status: $admin_pwd_status)"
    echo "Response: $admin_pwd_body"
    track_test_failure
fi

echo ""

print_success "🎉 Auth router test completed!" 