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
    local response=$(curl -s -X POST "$TEST_API_BASE/auth/admin/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$TEST_ADMIN_EMAIL\",\"password\":\"$TEST_ADMIN_PASSWORD\"}")
    
    if echo "$response" | grep -q '"access_token"'; then
        echo "$response" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4
    else
        echo ""
    fi
}

# Function to get admin API key
get_admin_api_key() {
    # Check if API key is provided via environment variable
    if [ -n "$INSFORGE_API_KEY" ]; then
        echo "$INSFORGE_API_KEY"
        return
    fi
    
    # Try to get API key from Docker logs as fallback
    if command -v docker >/dev/null 2>&1; then
        local api_key=$(docker logs insforge 2>&1 | grep "YOUR API KEY:" | tail -1 | grep -o 'ik_[a-zA-Z0-9]*' || echo "")
        if [ -n "$api_key" ]; then
            echo "$api_key"
            return
        fi
    fi
    
    # Otherwise, return empty
    echo ""
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
        
        if [ -n "$users_response" ] && echo "$users_response" | grep -q '\['; then
            local user_ids=()
            
            # Find IDs of test users by email
            for test_email in "${TEST_USERS_CREATED[@]}"; do
                local user_id=$(echo "$users_response" | grep -B2 -A2 "\"email\":\"$test_email\"" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
                if [ -n "$user_id" ]; then
                    user_ids+=("$user_id")
                    print_info "  - Found test user: $test_email (ID: $user_id)"
                fi
            done
            
            # Bulk delete test users
            if [ ${#user_ids[@]} -gt 0 ]; then
                local delete_response=$(curl -s -X DELETE "$TEST_API_BASE/auth/users/bulk-delete" \
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
                delete_response=$(curl -s -w "\n%{http_code}" -X DELETE "$TEST_API_BASE/storage/$bucket" \
                    -H "x-api-key: $api_key" 2>/dev/null || echo "500")
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