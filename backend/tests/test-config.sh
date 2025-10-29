#!/bin/bash

# Test configuration file
# Source this file in test scripts to get consistent configuration

# API Configuration
export TEST_API_BASE="${TEST_API_BASE:-http://localhost:7130/api}"

# Admin credentials - can be overridden by environment variables
export TEST_ADMIN_EMAIL="${TEST_ADMIN_EMAIL:-${ADMIN_EMAIL:-admin@example.com}}"
export TEST_ADMIN_PASSWORD="${TEST_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-change-this-password}}"

# User test credentials
export TEST_USER_EMAIL_PREFIX="${TEST_USER_EMAIL_PREFIX:-testuser_}"

# Colors for output
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export NC='\033[0m' # No Color

# Utility functions
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_fail() {
    echo -e "${RED}❌ $1${NC}"
    track_test_failure
}

print_info() {
    echo -e "${YELLOW}$1${NC}"
}

print_blue() {
    echo -e "${BLUE}$1${NC}"
}

# Function to login as admin and get token
get_admin_token() {
    # Use JWT admin endpoint
    local response=$(curl -s -X POST "$TEST_API_BASE/auth/admin/sessions" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$TEST_ADMIN_EMAIL\",\"password\":\"$TEST_ADMIN_PASSWORD\"}")
    
    if echo "$response" | grep -q '"accessToken"'; then
            echo "$response" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4
        else
            echo ""
        fi
}

# Function to get admin API key
get_admin_api_key() {
    # Only use ACCESS_API_KEY environment variable
    if [ -n "$ACCESS_API_KEY" ]; then
        echo "$ACCESS_API_KEY"
    else
        echo ""
    fi
}

# Check if required tools are installed
check_requirements() {
    if ! command -v curl &> /dev/null; then
        print_fail "curl is required but not installed"
        exit 1
    fi
    
    if ! command -v jq &> /dev/null; then
        print_info "jq is recommended for JSON parsing"
    fi
}

# Array to track test tables created
declare -a TEST_TABLES_CREATED=()

# Array to track test users created
declare -a TEST_USERS_CREATED=()

# Array to track test buckets created
declare -a TEST_BUCKETS_CREATED=()

# Array to track test AI configs created
declare -a TEST_AI_CONFIGS_CREATED=()

# Function to register a table for cleanup
register_test_table() {
    local table_name=$1
    TEST_TABLES_CREATED+=("$table_name")
}

# Function to register a user for cleanup
register_test_user() {
    local user_email=$1
    TEST_USERS_CREATED+=("$user_email")
}

# Function to register a bucket for cleanup
register_test_bucket() {
    local bucket_name=$1
    TEST_BUCKETS_CREATED+=("$bucket_name")
}

# Function to register an AI config for cleanup
register_test_ai_config() {
    local config_id=$1
    TEST_AI_CONFIGS_CREATED+=("$config_id")
}

# Function to register a user with Better Auth
register_user() {
    local email=$1
    local password=$2
    local name=${3:-"Test User"}
    
    # Use JWT registration
    curl -s -X POST "$TEST_API_BASE/auth/users" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$email\",\"password\":\"$password\",\"name\":\"$name\"}"
}

# Function to login a user with Better Auth
login_user() {
    local email=$1
    local password=$2
    
    # Use JWT login
    curl -s -X POST "$TEST_API_BASE/auth/sessions" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$email\",\"password\":\"$password\"}"
}

# Function to get user profile with auth token
get_user_profile() {
    local token=$1
    
    # Use JWT profile endpoint
    curl -s -X GET "$TEST_API_BASE/auth/sessions/current" \
        -H "Authorization: Bearer $token"
}

# Function to delete a table
delete_table() {
    local table_name=$1
    local token=$2
    
    curl -s -X DELETE "$TEST_API_BASE/database/tables/$table_name" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" > /dev/null 2>&1
}

# Function to cleanup all test data
cleanup_test_data() {
    # Always attempt cleanup, even if some parts fail
    print_info "🧹 Cleaning up test data..."
    
    local cleanup_failed=0
    
    # Try to get credentials - but continue cleanup even if they fail
    local admin_token=$(get_admin_token 2>/dev/null || echo "")
    local api_key=$(get_admin_api_key 2>/dev/null || echo "")
    
    if [ -z "$admin_token" ]; then
        print_info "No admin token available - some cleanup may be limited"
    fi
    
    if [ -z "$api_key" ]; then
        print_info "No API key available - bucket cleanup may be limited"
    fi
    
    # 1. Delete all registered test tables
    if [ ${#TEST_TABLES_CREATED[@]} -gt 0 ]; then
        if [ -n "$admin_token" ]; then
            print_info "Deleting test tables..."
            for table in "${TEST_TABLES_CREATED[@]}"; do
                print_info "  - Deleting table: $table"
                if ! delete_table "$table" "$admin_token"; then
                    echo "    ✗ Failed to delete"
                    cleanup_failed=1
                else
                    echo "    ✓ Deleted"
                fi
            done
        else
            print_fail "Cannot delete tables without admin token"
            print_info "Tables to delete manually:"
            for table in "${TEST_TABLES_CREATED[@]}"; do
                echo "  - $table"
            done
            cleanup_failed=1
        fi
    fi
    
    # 2. Delete all test users
    if [ ${#TEST_USERS_CREATED[@]} -gt 0 ] && [ -n "$admin_token" ]; then
        print_info "Deleting test users..."
        
        # Get all users to find IDs of test users
        local users_response=$(curl -s -X GET "$TEST_API_BASE/auth/users?limit=100" \
            -H "Authorization: Bearer $admin_token" \
            -H "Content-Type: application/json" 2>/dev/null || echo "")
        
        if [ -n "$users_response" ] && echo "$users_response" | grep -q '"data"'; then
            local user_ids=()
            
            # Extract data array from response (new format uses "data" instead of "users")
            local users_json=$(echo "$users_response" | grep -o '"data":\[[^]]*\]' | sed 's/"data"://')
            
            # Find IDs of test users by email
            for test_email in "${TEST_USERS_CREATED[@]}"; do
                local user_id=$(echo "$users_json" | grep -B2 -A2 "\"email\":\"$test_email\"" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
                if [ -n "$user_id" ]; then
                    user_ids+=("$user_id")
                    print_info "  - Found test user: $test_email (ID: $user_id)"
                fi
            done
            
            # Bulk delete test users
            if [ ${#user_ids[@]} -gt 0 ]; then
                local delete_response=$(curl -s -X DELETE "$TEST_API_BASE/auth/users" \
                    -H "Authorization: Bearer $admin_token" \
                    -H "Content-Type: application/json" \
                    -d "{\"userIds\": [$(printf '"%s",' "${user_ids[@]}" | sed 's/,$//' )]}")
                
                if ! echo "$delete_response" | grep -q '"error"'; then
                    print_success "  Deleted ${#user_ids[@]} test users"
                else
                    print_fail "  Failed to delete test users"
                    echo "    Response: $delete_response"
                fi
            fi
        else
            print_fail "  Could not list users for cleanup"
        fi
    fi
    
    # 3. Delete all test buckets
    if [ ${#TEST_BUCKETS_CREATED[@]} -gt 0 ]; then
        if [ -n "$api_key" ]; then
            print_info "Deleting test buckets..."
            for bucket in "${TEST_BUCKETS_CREATED[@]}"; do
                print_info "  - Deleting bucket: $bucket"
                delete_response=$(curl -s -w "\n%{http_code}" -X DELETE "$TEST_API_BASE/storage/buckets/$bucket" \
                    -H "Authorization: Bearer $api_key" 2>/dev/null || echo "500")
                status=$(echo "$delete_response" | tail -n 1)
                if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
                    echo "    ✓ Deleted"
                else
                    echo "    ✗ Failed (status: $status)"
                    cleanup_failed=1
                fi
            done
        else
            print_fail "Cannot delete buckets without API key"
            print_info "Buckets to delete manually:"
            for bucket in "${TEST_BUCKETS_CREATED[@]}"; do
                echo "  - $bucket"
            done
            cleanup_failed=1
        fi
    fi

    # 4. Delete all test AI configurations
    if [ ${#TEST_AI_CONFIGS_CREATED[@]} -gt 0 ]; then
        if [ -n "$admin_token" ]; then
            print_info "Deleting test AI configurations..."
            for config_id in "${TEST_AI_CONFIGS_CREATED[@]}"; do
                print_info "  - Deleting AI config: $config_id"
                delete_response=$(curl -s -w "\n%{http_code}" -X DELETE "$TEST_API_BASE/ai/configurations/$config_id" \
                    -H "Authorization: Bearer $admin_token" 2>/dev/null || echo "500")
                status=$(echo "$delete_response" | tail -n 1)
                # 404 is OK - means already deleted
                if [ "$status" -ge 200 ] && [ "$status" -lt 300 ] || [ "$status" -eq 404 ]; then
                    echo "    ✓ Deleted (or already gone)"
                else
                    echo "    ✗ Failed (status: $status)"
                    cleanup_failed=1
                fi
            done
        else
            print_fail "Cannot delete AI configs without admin token"
            print_info "AI configs to delete manually:"
            for config_id in "${TEST_AI_CONFIGS_CREATED[@]}"; do
                echo "  - $config_id"
            done
            cleanup_failed=1
        fi
    fi

    if [ $cleanup_failed -eq 1 ]; then
        print_fail "Cleanup completed with errors - some resources may need manual cleanup"
    else
        print_success "Cleanup completed successfully"
    fi
}

# Test failure tracking
TEST_FAILED=0

# Function to track test failures
track_test_failure() {
    TEST_FAILED=1
}

# Function to exit with proper code
exit_with_status() {
    if [ $TEST_FAILED -eq 1 ]; then
        exit 1
    else
        exit 0
    fi
}

# Set error handling
set -E  # Inherit ERR trap in functions

# Function to handle script termination
handle_exit() {
    local exit_code=$?
    
    # Run cleanup
    cleanup_test_data
    
    # Exit with the original exit code or our tracked failure status
    if [ $TEST_FAILED -eq 1 ] || [ $exit_code -ne 0 ]; then
        exit 1
    else
        exit 0
    fi
}

# Trap to ensure cleanup runs on any exit condition
trap handle_exit EXIT
trap handle_exit ERR
trap handle_exit INT
trap handle_exit TERM