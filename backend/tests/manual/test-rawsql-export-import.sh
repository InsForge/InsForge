#!/bin/bash

# Test RawSQL, Export, and Import endpoints
# This script tests the database advanced operations

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Source the test configuration
source "$SCRIPT_DIR/../test-config.sh"

# Check requirements
check_requirements

print_blue "🧪 Testing RawSQL, Export, and Import Endpoints..."

# Test tracking
TEST_FAILED=0

# Function to track test failures
track_test_failure() {
    TEST_FAILED=$((TEST_FAILED + 1))
}

# Function to cleanup and exit
cleanup_and_exit() {
    local exit_code=$1
    
    print_info "🧹 Cleaning up test data..."
    
    # Drop the test table if it exists
    if [ -n "$AUTH_TOKEN" ]; then
        print_info "Dropping large_table..."
        local drop_response=$(curl -s -X POST "$API_BASE/database/advance/rawsql" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -d '{
                "query": "DROP TABLE IF EXISTS large_table CASCADE;"
            }')
        
        if echo "$drop_response" | grep -q '"success"'; then
            print_success "Table large_table dropped successfully"
        else
            print_info "Table cleanup response: $drop_response"
        fi
    fi
    
    exit $exit_code
}

# Function to exit with proper status
exit_with_status() {
    if [ $TEST_FAILED -eq 0 ]; then
        print_success "All tests passed!"
        cleanup_and_exit 0
    else
        print_fail "Failed $TEST_FAILED test(s)"
        cleanup_and_exit 1
    fi
}

# API Configuration
API_BASE="$TEST_API_BASE"
AUTH_TOKEN=""

# Read .env file to get root admin credentials
if [ -f "$SCRIPT_DIR/../../.env" ]; then
    set -a
    source "$SCRIPT_DIR/../../.env"
    set +a
    print_info "Loaded environment variables from .env"
fi

# Use root admin credentials from environment
ROOT_ADMIN_USERNAME="${ROOT_ADMIN_USERNAME:-admin}"
ROOT_ADMIN_PASSWORD="${ROOT_ADMIN_PASSWORD:-change-this-password}"

print_info "Using root admin username: $ROOT_ADMIN_USERNAME"

# ========================================
# 1. Login as admin
# ========================================
print_blue "1. Logging in as admin..."

admin_login_payload=$(build_admin_login_payload "$ROOT_ADMIN_USERNAME" "$ROOT_ADMIN_PASSWORD")
auth_response=$(curl -s -X POST "$API_BASE/auth/admin/sessions" \
    -H "Content-Type: application/json" \
    -d "$admin_login_payload")

# Check if login was successful
if echo "$auth_response" | grep -q '"accessToken"'; then
    AUTH_TOKEN=$(echo "$auth_response" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
    print_success "Admin login successful"
else
    print_fail "Failed to login as admin"
    echo "Response: $auth_response"
    exit 1
fi

# ========================================
# 2. Create large_table using RawSQL
# ========================================
print_blue "2. Creating large_table using RawSQL endpoint..."

# Step 1: Create the basic table
print_info "Creating basic table structure..."
CREATE_TABLE_SQL=$(cat "$SCRIPT_DIR/create-large-table-simple.sql")

if command -v jq &> /dev/null; then
    json_payload=$(jq -n --arg query "$CREATE_TABLE_SQL" '{"query": $query}')
    create_response=$(curl -s -X POST "$API_BASE/database/advance/rawsql" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -d "$json_payload")
else
    CREATE_TABLE_SQL_ESCAPED=$(echo "$CREATE_TABLE_SQL" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' ' ')
    create_response=$(curl -s -X POST "$API_BASE/database/advance/rawsql" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -d "{\"query\": \"$CREATE_TABLE_SQL_ESCAPED\"}")
fi

if echo "$create_response" | grep -q '"error"'; then
    print_fail "Failed to create table"
    echo "Response: $create_response"
    track_test_failure
else
    print_success "Basic table created successfully"
    
    # Step 2: Add indexes, triggers and RLS
    print_info "Setting up indexes, triggers and RLS..."
    SETUP_SQL=$(cat "$SCRIPT_DIR/setup-large-table-extras.sql")
    
    if command -v jq &> /dev/null; then
        json_payload=$(jq -n --arg query "$SETUP_SQL" '{"query": $query}')
        setup_response=$(curl -s -X POST "$API_BASE/database/advance/rawsql" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -d "$json_payload")
    else
        SETUP_SQL_ESCAPED=$(echo "$SETUP_SQL" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | tr '\n' ' ')
        setup_response=$(curl -s -X POST "$API_BASE/database/advance/rawsql" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -d "{\"query\": \"$SETUP_SQL_ESCAPED\"}")
    fi
    
    if echo "$setup_response" | grep -q '"error"'; then
        print_fail "Failed to setup table extras"
        echo "Response: $setup_response"
        track_test_failure
    else
        print_success "Table fully configured with indexes, triggers and RLS"
    fi
fi

# ========================================
# 3. Verify table schema
# ========================================
print_blue "3. Verifying table schema..."

# Get table schema
schema_response=$(curl -s "$API_BASE/metadata/large_table" \
    -H "Authorization: Bearer $AUTH_TOKEN")

if echo "$schema_response" | grep -q '"large_table"'; then
    print_success "Table schema retrieved successfully"
    
    # Verify required columns exist
    if echo "$schema_response" | grep -q '"columnName":"user_id"' && \
       echo "$schema_response" | grep -q '"columnName":"created_at"' && \
       echo "$schema_response" | grep -q '"columnName":"updated_at"'; then
        print_success "Required columns (user_id, created_at, updated_at) exist"
    else
        print_fail "Missing required columns"
        echo "Schema response: $schema_response"
        track_test_failure
    fi
    
    # Verify RLS is enabled
    if echo "$schema_response" | grep -q '"rlsEnabled":true'; then
        print_success "RLS is enabled on the table"
    else
        print_fail "RLS is not enabled"
        track_test_failure
    fi
else
    print_fail "Failed to get table schema"
    echo "Response: $schema_response"
    track_test_failure
fi

# ========================================
# 4. Import test data
# ========================================
print_blue "4. Importing test data using Import endpoint..."

# Use multipart form-data to upload the SQL file
import_response=$(curl -s -X POST "$API_BASE/database/advance/import" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -F "file=@$SCRIPT_DIR/seed-large-table.sql" \
    -F "truncate=false")

if echo "$import_response" | grep -q '"error"'; then
    print_fail "Failed to import data"
    echo "Response: $import_response"
    track_test_failure
else
    print_success "Data imported successfully"
    
    # Check if response contains success information
    if echo "$import_response" | grep -q '"rowsAffected"'; then
        rows_affected=$(echo "$import_response" | grep -o '"rowsAffected":[0-9]*' | cut -d':' -f2)
        print_success "Rows affected: $rows_affected"
        
        if [ "$rows_affected" -ge 1000 ]; then
            print_success "Successfully imported 1000+ rows"
        else
            print_fail "Less than 1000 rows imported"
            track_test_failure
        fi
    fi
fi

# ========================================
# 5. Verify imported data
# ========================================
print_blue "5. Verifying imported data..."

# Count records using RawSQL
count_response=$(curl -s -X POST "$API_BASE/database/advance/rawsql" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d '{
        "query": "SELECT COUNT(*) as total FROM large_table;"
    }')

if echo "$count_response" | grep -q '"rows"'; then
    # Extract the count from the rows array
    if command -v jq &> /dev/null; then
        total_count=$(echo "$count_response" | jq -r '.rows[0].total // 0')
    else
        # Fallback without jq
        total_count=$(echo "$count_response" | grep -o '"total":[0-9]*' | cut -d':' -f2 | head -1)
        if [ -z "$total_count" ]; then
            # Try another pattern
            total_count=$(echo "$count_response" | sed -n 's/.*"total":\([0-9]*\).*/\1/p' | head -1)
        fi
    fi
    
    if [ -n "$total_count" ] && [ "$total_count" -ge 0 ]; then
        print_info "Total records in large_table: $total_count"
        
        if [ "$total_count" -ge 1000 ]; then
            print_success "Table contains 1000+ records as expected"
        else
            print_fail "Table has less than 1000 records ($total_count found)"
            track_test_failure
        fi
    else
        print_fail "Could not parse record count"
        echo "Response: $count_response"
        track_test_failure
    fi
else
    print_fail "Failed to count records"
    echo "Response: $count_response"
    track_test_failure
fi

# ========================================
# 6. Test Export endpoint
# ========================================
print_blue "6. Testing Export endpoint..."

# Export all data including schema
export_response=$(curl -s -X POST "$API_BASE/database/advance/export" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d '{
        "tables": ["large_table"],
        "format": "sql",
        "includeData": true,
        "includeFunctions": true,
        "includeSequences": true,
        "includeViews": false
    }')

if echo "$export_response" | grep -q '"error"'; then
    print_fail "Failed to export database"
    echo "Response preview: $(echo "$export_response" | head -c 500)..."
    track_test_failure
else
    print_success "Database exported successfully"
    
    # Verify export contains expected elements
    if echo "$export_response" | grep -q '"data"'; then
        export_content=$(echo "$export_response" | jq -r '.data // empty')
        
        if [ -n "$export_content" ]; then
            # Check for table creation (use case statement to avoid broken pipe)
            case "$export_content" in
                *"CREATE TABLE"*"large_table"*)
                    print_success "Export contains table creation statement"
                    ;;
                *)
                    print_fail "Export missing table creation statement"
                    track_test_failure
                    ;;
            esac
            
            # Check for data
            case "$export_content" in
                *"INSERT INTO"*"large_table"*)
                    print_success "Export contains data insertion statements"
                    ;;
                *)
                    print_fail "Export missing data insertion statements"
                    track_test_failure
                    ;;
            esac
            
            # Check for RLS policies
            case "$export_content" in
                *"CREATE POLICY"*)
                    print_success "Export contains RLS policies"
                    ;;
                *)
                    print_fail "Export missing RLS policies"
                    track_test_failure
                    ;;
            esac
            
            # Check for trigger
            case "$export_content" in
                *"CREATE TRIGGER"*"update_large_table_updated_at"*)
                    print_success "Export contains update trigger"
                    ;;
                *)
                    print_fail "Export missing update trigger"
                    track_test_failure
                    ;;
            esac
            
            # Count INSERT statements to verify all data exported (using awk for efficiency)
            insert_count=$(echo "$export_content" | awk '/INSERT INTO/ {count++} END {print count+0}')
            print_info "Number of INSERT statements in export: $insert_count"
        else
            print_fail "Export content is empty"
            track_test_failure
        fi
    else
        print_fail "Export response missing data field"
        echo "Response structure: $(echo "$export_response" | jq -r 'keys' 2>/dev/null || echo "$export_response" | head -c 200)"
        track_test_failure
    fi
fi

# ========================================
# 7. Test Export with row limit
# ========================================
print_blue "7. Testing Export with row limit..."

limited_export_response=$(curl -s -X POST "$API_BASE/database/advance/export" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d '{
        "tables": ["large_table"],
        "format": "sql",
        "includeData": true,
        "rowLimit": 10
    }')

if echo "$limited_export_response" | grep -q '"error"'; then
    print_fail "Failed to export with row limit"
    echo "Response preview: $(echo "$limited_export_response" | head -c 500)..."
    track_test_failure
else
    print_success "Export with row limit successful"
    
    if echo "$limited_export_response" | grep -q '"data"'; then
        limited_content=$(echo "$limited_export_response" | jq -r '.data // empty')
        
        # Count data rows in limited export (should be much less than full export)
        if [ -n "$limited_content" ]; then
            limited_insert_count=$(echo "$limited_content" | awk '/INSERT INTO/ {count++} END {print count+0}')
            print_info "INSERT statements in limited export: $limited_insert_count"
            
            # Only compare if insert_count is set and valid
            if [ -n "$insert_count" ] && [ "$insert_count" -gt 0 ] 2>/dev/null; then
                if [ "$limited_insert_count" -lt "$insert_count" ] 2>/dev/null; then
                    print_success "Row limit is working (limited export has fewer rows)"
                else
                    print_info "Unable to verify row limit effectiveness"
                fi
            else
                print_info "Skipping row limit comparison (no full export count available)"
            fi
        fi
    fi
fi

# ========================================
# Summary
# ========================================
echo ""
print_blue "=========================================="
print_blue "RawSQL/Export/Import Test Complete"
print_blue "=========================================="

# Exit with proper status
exit_with_status
