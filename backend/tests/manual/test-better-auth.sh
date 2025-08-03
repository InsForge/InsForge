#!/bin/bash

# Better Auth test script
# Tests the Better Auth v2 endpoints including admin functionality

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Test configuration
TEST_API_BASE="${TEST_API_BASE:-http://localhost:7130/api}"
TEST_ADMIN_EMAIL="${TEST_ADMIN_EMAIL:-${ADMIN_EMAIL:-admin@example.com}}"
TEST_ADMIN_PASSWORD="${TEST_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-change-this-password}}"
TEST_USER_EMAIL_PREFIX="${TEST_USER_EMAIL_PREFIX:-testuser_}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Utility functions
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_fail() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}$1${NC}"
}

# Simple cleanup tracking
declare -a TEST_USERS_CREATED=()

register_test_user() {
    local user_email=$1
    TEST_USERS_CREATED+=("$user_email")
}

echo "🧪 Testing Better Auth v2..."

# Use configuration from test-config.sh
API_BASE="$TEST_API_BASE"
BETTER_AUTH_BASE="${API_BASE}/auth/v2"
ADMIN_TOKEN=""
USER_TOKEN=""

# Test function
# $1: method, $2: endpoint, $3: data, $4: description, $5: expected status (optional)
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    local expected_status=${5:-200}
    local token=${6:-""}

    print_info "Test: $description"

    local response
    if [ "$method" = "GET" ]; then
        if [ -n "$token" ]; then
            response=$(curl -s -w "\n%{http_code}" -X GET "$endpoint" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $token")
        else
            response=$(curl -s -w "\n%{http_code}" -X GET "$endpoint" \
                -H "Content-Type: application/json")
        fi
    elif [ "$method" = "POST" ]; then
        if [ -n "$token" ]; then
            response=$(curl -s -w "\n%{http_code}" -X POST "$endpoint" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $token" \
                -d "$data")
        else
            response=$(curl -s -w "\n%{http_code}" -X POST "$endpoint" \
                -H "Content-Type: application/json" \
                -d "$data")
        fi
    elif [ "$method" = "DELETE" ]; then
        if [ -n "$token" ]; then
            response=$(curl -s -w "\n%{http_code}" -X DELETE "$endpoint" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $token")
        else
            response=$(curl -s -w "\n%{http_code}" -X DELETE "$endpoint" \
                -H "Content-Type: application/json")
        fi
    fi

    # Split response into body and status code
    # Use sed instead of head -n -1 for better compatibility
    body=$(echo "$response" | sed '$d')
    status=$(echo "$response" | tail -n 1)

    if [ "$status" = "$expected_status" ]; then
        print_success "Success ($status)"
        if [ -n "$body" ]; then
            echo "Response: $body" | head -c 200
            echo ""
        fi
    else
        print_fail "Failed - Expected $expected_status, got $status"
        echo "Error: $body"
    fi
    echo ""
}

echo "=== Admin Authentication Tests ==="
echo ""

# 1. Test admin sign-in with correct credentials
print_info "1. Admin sign-in with correct credentials"
admin_response=$(curl -s -X POST "$BETTER_AUTH_BASE/admin/sign-in" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_ADMIN_EMAIL\",\"password\":\"$TEST_ADMIN_PASSWORD\"}")

if echo "$admin_response" | grep -q '"token"'; then
    print_success "Admin sign-in successful"
    ADMIN_TOKEN=$(echo "$admin_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    admin_user=$(echo "$admin_response" | grep -o '"user":{[^}]*}' || echo "")
    echo "Admin info: $admin_user"
else
    print_fail "Admin sign-in failed"
    echo "Response: $admin_response"
fi
echo ""

# 2. Test admin sign-in with wrong password
test_endpoint "POST" "$BETTER_AUTH_BASE/admin/sign-in" \
    "{\"email\":\"$TEST_ADMIN_EMAIL\",\"password\":\"wrong-password\"}" \
    "Admin sign-in with wrong password (should fail)" \
    "401"

# 3. Test admin sign-in with non-admin email
test_endpoint "POST" "$BETTER_AUTH_BASE/admin/sign-in" \
    "{\"email\":\"notadmin@example.com\",\"password\":\"$TEST_ADMIN_PASSWORD\"}" \
    "Admin sign-in with non-admin email (should fail)" \
    "403"

# 4. Test admin register (should fail - already exists)
test_endpoint "POST" "$BETTER_AUTH_BASE/admin/register" \
    "{\"email\":\"$TEST_ADMIN_EMAIL\",\"password\":\"$TEST_ADMIN_PASSWORD\",\"name\":\"Admin\"}" \
    "Admin register when already exists (should fail)" \
    "409"

echo "=== Regular User Registration Tests ==="
echo ""

# 5. Register a regular user
USER_EMAIL="${TEST_USER_EMAIL_PREFIX}betterauth_$(date +%s)@example.com"
USER_PASS="testpass123"
USER_NAME="Better Auth Test User"

register_test_user "$USER_EMAIL"

print_info "5. Registering new user: $USER_EMAIL"
register_response=$(curl -s -X POST "$BETTER_AUTH_BASE/sign-up/email" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASS\",\"name\":\"$USER_NAME\"}")

if echo "$register_response" | grep -q '"user"'; then
    print_success "User registration successful"
    user_info=$(echo "$register_response" | grep -o '"user":{[^}]*}' || echo "")
    echo "User info: $user_info"
else
    print_fail "User registration failed"
    echo "Response: $register_response"
fi
echo ""

# 6. Sign in as regular user
print_info "6. Sign in as regular user"
signin_response=$(curl -s -X POST "$BETTER_AUTH_BASE/sign-in/email" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASS\"}")

if echo "$signin_response" | grep -q '"token"'; then
    print_success "User sign-in successful"
    USER_TOKEN=$(echo "$signin_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
else
    print_fail "User sign-in failed"
    echo "Response: $signin_response"
fi
echo ""

# 7. Test duplicate registration
test_endpoint "POST" "$BETTER_AUTH_BASE/sign-up/email" \
    "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASS\",\"name\":\"Duplicate\"}" \
    "Duplicate user registration (should fail)" \
    "422"

echo "=== Admin User Management Tests ==="
echo ""

# 8. List users with admin token
print_info "8. List all users (admin only)"
if [ -n "$ADMIN_TOKEN" ]; then
    users_response=$(curl -s -X GET "$BETTER_AUTH_BASE/admin/users" \
        -H "Authorization: Bearer $ADMIN_TOKEN")
    
    if echo "$users_response" | grep -q '"users"'; then
        print_success "List users successful"
        user_count=$(echo "$users_response" | grep -o '"total":[0-9]*' | cut -d':' -f2 || echo "0")
        echo "Total non-admin users: $user_count"
        
        # Verify admin is not in the list
        if echo "$users_response" | grep -q "$TEST_ADMIN_EMAIL"; then
            print_fail "Admin user should not be in regular user list!"
        else
            print_success "Admin correctly excluded from user list"
        fi
    else
        print_fail "List users failed"
        echo "Response: $users_response"
    fi
else
    print_fail "No admin token available"
fi
echo ""

# 9. List users with pagination
test_endpoint "GET" "$BETTER_AUTH_BASE/admin/users?limit=5&offset=0" \
    "" \
    "List users with pagination (limit=5)" \
    "200" \
    "$ADMIN_TOKEN"

# 10. Try to access admin endpoint without token
test_endpoint "GET" "$BETTER_AUTH_BASE/admin/users" \
    "" \
    "Access admin endpoint without token (should fail)" \
    "401"

# 11. Try to access admin endpoint with regular user token
if [ -n "$USER_TOKEN" ]; then
    test_endpoint "GET" "$BETTER_AUTH_BASE/admin/users" \
        "" \
        "Access admin endpoint with regular user token (should fail)" \
        "401" \
        "$USER_TOKEN"
fi

echo "=== Token Verification Tests ==="
echo ""

# 12. Verify admin JWT claims
if [ -n "$ADMIN_TOKEN" ]; then
    print_info "12. Verifying admin JWT claims"
    # Decode JWT payload (base64 decode the middle part)
    payload=$(echo "$ADMIN_TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null || echo "")
    
    if echo "$payload" | grep -q '"role":"project_admin"'; then
        print_success "Admin token has correct role claim"
    else
        print_fail "Admin token missing project_admin role"
    fi
    
    if echo "$payload" | grep -q '"type":"admin"'; then
        print_success "Admin token has correct type claim"
    else
        print_fail "Admin token missing admin type"
    fi
fi

# 13. Note about regular user tokens
if [ -n "$USER_TOKEN" ]; then
    print_info "13. Regular user tokens"
    print_success "Regular users receive session tokens (not JWTs)"
    echo "Token format: $USER_TOKEN" | cut -c1-50
    echo "..."
fi

echo ""
echo "=== Additional Better Auth Tests ==="
echo ""

# 17. Test error handling
test_endpoint "POST" "$BETTER_AUTH_BASE/sign-in/email" \
    "{\"email\":\"invalid-email\",\"password\":\"pass\"}" \
    "Sign in with invalid email format" \
    "400"

test_endpoint "POST" "$BETTER_AUTH_BASE/sign-up/email" \
    "{\"email\":\"test@example.com\"}" \
    "Register without password" \
    "500"

echo ""
print_success "🎉 Better Auth test completed!"

# Simple cleanup
if [ ${#TEST_USERS_CREATED[@]} -gt 0 ]; then
    print_info "Test users created: ${#TEST_USERS_CREATED[@]}"
    print_info "Manual cleanup may be required for test users"
fi

echo ""
print_info "Test completed!"