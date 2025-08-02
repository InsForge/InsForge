#!/bin/bash

# Comprehensive cleanup script for all test data
# This script removes ALL test data from the system including:
# - Test users (with email prefix "testuser_")
# - Test tables
# - Test buckets
# - Test API keys

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Source the test configuration for utilities
source "$SCRIPT_DIR/test-config.sh"

echo "=================================================="
echo "🧹 COMPREHENSIVE TEST DATA CLEANUP"
echo "=================================================="
echo ""
echo "⚠️  WARNING: This will delete ALL test data!"
echo "   - All users with email prefix: ${TEST_USER_EMAIL_PREFIX}"
echo "   - All tables with test prefixes"
echo "   - All test buckets"
echo ""
read -p "Are you sure you want to continue? (yes/no): " -n 3 -r
echo ""

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Cleanup cancelled."
    exit 0
fi

# Get admin credentials
admin_token=$(get_admin_token)
if [ -z "$admin_token" ]; then
    print_fail "Could not authenticate as admin. Please check admin credentials."
    exit 1
fi

print_success "Admin authentication successful"

# Get API key for storage operations
api_key=$(get_admin_api_key)
if [ -z "$api_key" ]; then
    print_info "No API key available for storage operations"
fi

# 1. Clean up test users
print_info "🧑 Searching for test users..."
users_response=$(curl -s -X GET "$TEST_API_BASE/auth/users?limit=100" \
    -H "Authorization: Bearer $admin_token" \
    -H "Content-Type: application/json")

if echo "$users_response" | grep -q '\['; then
    # Find all test users
    test_user_ids=()
    test_user_emails=()
    
    # Parse users and find test users
    while IFS= read -r line; do
        if [[ $line =~ \"email\":\"($TEST_USER_EMAIL_PREFIX[^\"]+)\" ]]; then
            email="${BASH_REMATCH[1]}"
            # Get the ID for this user
            id_line=$(echo "$users_response" | grep -B5 "\"email\":\"$email\"" | grep '"id"' | head -1)
            if [[ $id_line =~ \"id\":\"([^\"]+)\" ]]; then
                id="${BASH_REMATCH[1]}"
                test_user_ids+=("$id")
                test_user_emails+=("$email")
                print_info "  Found test user: $email (ID: $id)"
            fi
        fi
    done <<< "$users_response"
    
    if [ ${#test_user_ids[@]} -gt 0 ]; then
        print_info "Found ${#test_user_ids[@]} test users to delete"
        
        # Bulk delete test users
        delete_response=$(curl -s -X DELETE "$TEST_API_BASE/auth/users/bulk-delete" \
            -H "Authorization: Bearer $admin_token" \
            -H "Content-Type: application/json" \
            -d "{\"userIds\": [$(printf '"%s",' "${test_user_ids[@]}" | sed 's/,$//' )]}")
        
        if ! echo "$delete_response" | grep -q '"error"'; then
            print_success "✅ Deleted ${#test_user_ids[@]} test users"
        else
            print_fail "Failed to delete test users"
            echo "Response: $delete_response"
        fi
    else
        print_info "No test users found"
    fi
else
    print_fail "Could not list users"
fi

# 2. Clean up test tables
print_info "📋 Searching for test tables..."
tables_response=$(curl -s -X GET "$TEST_API_BASE/database/tables" \
    -H "Authorization: Bearer $admin_token" \
    -H "Content-Type: application/json")

if echo "$tables_response" | grep -q '\['; then
    # Find test tables (common patterns)
    test_tables=()
    test_patterns=("test_" "temp_" "_test" "_temp")
    
    while IFS= read -r line; do
        if [[ $line =~ \"table_name\":\"([^\"]+)\" ]]; then
            table="${BASH_REMATCH[1]}"
            # Check if table matches any test pattern
            for pattern in "${test_patterns[@]}"; do
                if [[ $table == *"$pattern"* ]]; then
                    test_tables+=("$table")
                    print_info "  Found test table: $table"
                    break
                fi
            done
        fi
    done <<< "$tables_response"
    
    if [ ${#test_tables[@]} -gt 0 ]; then
        print_info "Found ${#test_tables[@]} test tables to delete"
        
        for table in "${test_tables[@]}"; do
            print_info "  Deleting table: $table"
            curl -s -X DELETE "$TEST_API_BASE/database/tables/$table" \
                -H "Authorization: Bearer $admin_token" \
                -H "Content-Type: application/json" > /dev/null 2>&1
        done
        
        print_success "✅ Deleted ${#test_tables[@]} test tables"
    else
        print_info "No test tables found"
    fi
else
    print_fail "Could not list tables"
fi

# 3. Clean up test buckets
if [ -n "$api_key" ]; then
    print_info "🪣 Searching for test buckets..."
    buckets_response=$(curl -s -X GET "$TEST_API_BASE/storage/buckets" \
        -H "x-api-key: $api_key" \
        -H "Content-Type: application/json")
    
    if echo "$buckets_response" | grep -q '\['; then
        # Find test buckets
        test_buckets=()
        bucket_patterns=("test" "temp" "public-images-" "private-docs-")
        
        while IFS= read -r line; do
            if [[ $line =~ \"name\":\"([^\"]+)\" ]]; then
                bucket="${BASH_REMATCH[1]}"
                # Check if bucket matches any test pattern
                for pattern in "${bucket_patterns[@]}"; do
                    if [[ $bucket == *"$pattern"* ]]; then
                        test_buckets+=("$bucket")
                        print_info "  Found test bucket: $bucket"
                        break
                    fi
                done
            fi
        done <<< "$buckets_response"
        
        if [ ${#test_buckets[@]} -gt 0 ]; then
            print_info "Found ${#test_buckets[@]} test buckets to delete"
            
            for bucket in "${test_buckets[@]}"; do
                print_info "  Deleting bucket: $bucket"
                delete_response=$(curl -s -w "\n%{http_code}" -X DELETE "$TEST_API_BASE/storage/$bucket" \
                    -H "x-api-key: $api_key")
                status=$(echo "$delete_response" | tail -n 1)
                if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
                    echo "    ✓ Deleted"
                else
                    echo "    ✗ Failed (status: $status)"
                fi
            done
            
            print_success "✅ Deleted ${#test_buckets[@]} test buckets"
        else
            print_info "No test buckets found"
        fi
    else
        print_fail "Could not list buckets"
    fi
else
    print_info "Skipping bucket cleanup (no API key available)"
fi

# 4. Clean up test API keys
print_info "🔑 Searching for test API keys..."
api_keys_response=$(curl -s -X GET "$TEST_API_BASE/auth/api-keys" \
    -H "Authorization: Bearer $admin_token" \
    -H "Content-Type: application/json")

if echo "$api_keys_response" | grep -q '\['; then
    # Find test API keys
    test_key_ids=()
    
    while IFS= read -r line; do
        if [[ $line =~ \"name\":\"([^\"]*[Tt]est[^\"]*)\".+\"id\":\"([^\"]+)\" ]]; then
            name="${BASH_REMATCH[1]}"
            id="${BASH_REMATCH[2]}"
            test_key_ids+=("$id")
            print_info "  Found test API key: $name (ID: $id)"
        fi
    done <<< "$api_keys_response"
    
    if [ ${#test_key_ids[@]} -gt 0 ]; then
        print_info "Found ${#test_key_ids[@]} test API keys to delete"
        
        for key_id in "${test_key_ids[@]}"; do
            print_info "  Deleting API key: $key_id"
            curl -s -X DELETE "$TEST_API_BASE/auth/api-keys/$key_id" \
                -H "Authorization: Bearer $admin_token" \
                -H "Content-Type: application/json" > /dev/null 2>&1
        done
        
        print_success "✅ Deleted ${#test_key_ids[@]} test API keys"
    else
        print_info "No test API keys found"
    fi
else
    print_fail "Could not list API keys"
fi

echo ""
echo "=================================================="
print_success "🎉 Cleanup completed!"
echo "=================================================="