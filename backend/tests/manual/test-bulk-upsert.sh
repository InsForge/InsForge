#!/bin/bash

# Bulk Upsert Feature Test Script
# Tests CSV/JSON bulk imports with various edge cases and upsert scenarios

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Source the test configuration
source "$SCRIPT_DIR/../test-config.sh"

echo "🧪 Testing bulk upsert feature..."
echo "================================"

# Configuration
# Remove /api if it's already included in TEST_API_BASE
if [[ "$TEST_API_BASE" == */api ]]; then
    API_BASE="$TEST_API_BASE"
else
    API_BASE="${TEST_API_BASE}/api"
fi
ADMIN_EMAIL="$TEST_ADMIN_EMAIL"
ADMIN_PASSWORD="$TEST_ADMIN_PASSWORD"
AUTH_TOKEN=""

# Dynamic table name to avoid conflicts
TEST_TABLE="test_bulk_upsert_$(date +%s)"
DATA_DIR="$SCRIPT_DIR/test-data/bulk-upsert"

# Create test data directory
mkdir -p "$DATA_DIR"

# Helper function to create test files
create_test_files() {
    echo "📁 Creating test data files..."
    
    # 1. Basic CSV file
    cat > "$DATA_DIR/products.csv" << 'EOF'
sku,name,price,quantity,active
PROD-001,Laptop Computer,1299.99,50,true
PROD-002,Wireless Mouse,29.99,200,true
PROD-003,USB-C Cable,19.99,500,false
PROD-004,Monitor Stand,79.99,100,true
PROD-005,Keyboard,89.99,150,true
EOF

    # 2. CSV with special characters
    cat > "$DATA_DIR/special-chars.csv" << 'EOF'
sku,name,description,price
SPEC-001,"Product with ""quotes""","Description with ""quoted text""",99.99
SPEC-002,"Product, with comma","Has a comma, in the name",149.99
SPEC-003,"Multi-line
Product","Description
spans multiple
lines",199.99
SPEC-004,"Special & < > chars","Contains & < > $ % characters",49.99
EOF

    # 3. CSV for upsert testing (contains duplicates)
    cat > "$DATA_DIR/upsert-test.csv" << 'EOF'
sku,name,price,quantity,active
PROD-001,Updated Laptop,1399.99,45,true
PROD-002,Updated Mouse,34.99,180,false
PROD-006,New Headphones,149.99,75,true
EOF

    # 4. JSON array file
    cat > "$DATA_DIR/products.json" << 'EOF'
[
  {
    "sku": "JSON-001",
    "name": "Smart Watch",
    "price": 299.99,
    "quantity": 30,
    "active": true,
    "metadata": {
      "brand": "TechCo",
      "warranty": "2 years"
    }
  },
  {
    "sku": "JSON-002",
    "name": "Bluetooth Speaker",
    "price": 89.99,
    "quantity": 100,
    "active": true,
    "metadata": {
      "color": "black",
      "waterproof": true
    }
  },
  {
    "sku": "JSON-003",
    "name": "Phone Case",
    "price": 24.99,
    "quantity": 250,
    "active": false,
    "metadata": null
  }
]
EOF

    # 5. Single JSON object
    cat > "$DATA_DIR/single-product.json" << 'EOF'
{
  "sku": "SINGLE-001",
  "name": "Premium Subscription",
  "price": 99.99,
  "quantity": 999,
  "active": true,
  "metadata": {
    "type": "subscription",
    "duration": "annual"
  }
}
EOF

    # 6. CSV with NULL values
    cat > "$DATA_DIR/null-values.csv" << 'EOF'
sku,name,price,quantity,active
NULL-001,,99.99,,true
NULL-002,Product with nulls,,,false
NULL-003,Only SKU and Name,,,
NULL-004,Complete Product,49.99,25,true
EOF

    # 7. Large CSV file (1000 rows)
    echo "sku,name,price,quantity,active" > "$DATA_DIR/large-dataset.csv"
    for i in $(seq 1 1000); do
        echo "LARGE-$(printf %04d $i),Product $i,$(echo "scale=2; $RANDOM/100" | bc),$(($RANDOM % 1000)),true" >> "$DATA_DIR/large-dataset.csv"
    done

    # 8. CSV with Unicode/Emoji
    cat > "$DATA_DIR/unicode.csv" << 'EOF'
sku,name,price,quantity,description
UNI-001,Café ☕ Français,15.99,100,Délicieux café
UNI-002,寿司 🍣 セット,35.99,50,新鮮な魚
UNI-003,Москва 🇷🇺 Souvenir,25.99,75,Русский сувенир
UNI-004,🚀 Rocket Toy,19.99,200,Fun emoji product 🎉
EOF

    # 9. Invalid CSV (for error testing)
    cat > "$DATA_DIR/invalid.csv" << 'EOF'
sku,name,price
INV-001,Product 1,99.99,Extra Column
INV-002,Missing Price
INV-003
EOF

    # 10. Empty files
    touch "$DATA_DIR/empty.csv"
    echo "[]" > "$DATA_DIR/empty.json"
    
    echo "✅ Test files created"
}

# Function to login as admin
login_admin() {
    echo "🔐 Logging in as admin..."
    
    # First check if backend is running
    if ! curl -s "$API_BASE/health" > /dev/null 2>&1; then
        echo "❌ Backend server is not running!"
        echo "   Please start the backend first:"
        echo "   cd backend && npm run dev"
        exit 1
    fi
    
    local response=$(curl -s -X POST "$API_BASE/auth/admin/sessions" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
    
    AUTH_TOKEN=$(echo "$response" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
    
    if [ -z "$AUTH_TOKEN" ]; then
        echo "❌ Failed to login as admin"
        echo "   Response: $response"
        echo ""
        echo "   Make sure you have the correct admin credentials:"
        echo "   Email: $ADMIN_EMAIL"
        echo "   Password: $ADMIN_PASSWORD"
        echo ""
        echo "   You can set these with environment variables:"
        echo "   TEST_ADMIN_EMAIL=your@email.com TEST_ADMIN_PASSWORD=yourpassword ./test-bulk-upsert.sh"
        exit 1
    fi
    
    echo "✅ Admin login successful"
}

# Function to create test table
create_test_table() {
    echo "📊 Creating test table: $TEST_TABLE"
    
    local response=$(curl -s -X POST "$API_BASE/database/advance/rawsql" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"query\": \"CREATE TABLE $TEST_TABLE (id SERIAL PRIMARY KEY, sku VARCHAR(50) UNIQUE, name VARCHAR(255), description TEXT, price DECIMAL(10,2), quantity INTEGER, active BOOLEAN, metadata JSONB)\"}")
    
    if echo "$response" | grep -q "error"; then
        echo "❌ Failed to create table: $response"
        exit 1
    fi
    
    echo "✅ Table created successfully"
    
    # Register table for cleanup
    register_test_table "$TEST_TABLE"
}

# Function to test bulk upsert
test_bulk_upsert() {
    local file_name=$1
    local table=$2
    local upsert_key=$3
    local description=$4
    local expect_failure=${5:-false}
    
    if [ "$expect_failure" != "true" ]; then
        echo ""
        echo "🧪 Test: $description"
        echo "   File: $file_name"
    fi
    
    # Build form data
    local curl_cmd="curl -s -X POST \"$API_BASE/database/advance/bulk-upsert\" \
        -H \"Authorization: Bearer $AUTH_TOKEN\" \
        -F \"file=@$DATA_DIR/$file_name\" \
        -F \"table=$table\""
    
    if [ ! -z "$upsert_key" ]; then
        curl_cmd="$curl_cmd -F \"upsertKey=$upsert_key\""
    fi
    
    local response=$(eval $curl_cmd)
    
    if echo "$response" | grep -q "\"success\":true"; then
        local rows=$(echo "$response" | grep -o '"rowsAffected":[0-9]*' | cut -d':' -f2)
        local total=$(echo "$response" | grep -o '"totalRecords":[0-9]*' | cut -d':' -f2)
        if [ "$expect_failure" != "true" ]; then
            echo "   ✅ Success: $rows/$total rows inserted"
        fi
        return 0
    else
        local error=$(echo "$response" | grep -o '"message":"[^"]*' | cut -d'"' -f4)
        if [ "$expect_failure" != "true" ]; then
            echo "   ⚠️  Expected error: $error"
        fi
        return 1
    fi
}

# Function to verify data
verify_data() {
    local expected_count=$1
    local description=$2
    
    echo ""
    echo "🔍 Verifying: $description"
    
    local response=$(curl -s -X POST "$API_BASE/database/advance/rawsql" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"query\": \"SELECT COUNT(*) as count FROM $TEST_TABLE\"}")
    
    local actual_count=$(echo "$response" | grep -o '"count":"[0-9]*' | cut -d'"' -f4)
    
    if [ "$actual_count" = "$expected_count" ]; then
        echo "   ✅ Correct: $actual_count rows in table"
    else
        echo "   ❌ Mismatch: Expected $expected_count, got $actual_count"
        return 1
    fi
}

# Function to check specific data
check_data() {
    local query=$1
    local expected=$2
    local description=$3
    
    echo "   🔍 $description"
    
    local response=$(curl -s -X POST "$API_BASE/database/advance/rawsql" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"query\": \"$query\"}")
    
    if echo "$response" | grep -q "$expected"; then
        echo "      ✅ Found: $expected"
    else
        echo "      ❌ Not found: $expected"
        echo "      Response: $response"
    fi
}

# Cleanup function
cleanup() {
    echo ""
    echo "🧹 Cleaning up..."
    
    # Drop test table
    curl -s -X POST "$API_BASE/database/advance/rawsql" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"query\": \"DROP TABLE IF EXISTS $TEST_TABLE CASCADE\"}" > /dev/null
    
    # Remove test data directory
    rm -rf "$DATA_DIR"
    
    echo "✅ Cleanup complete"
}

# Main test execution
main() {
    # Setup
    create_test_files
    login_admin
    create_test_table
    
    echo ""
    echo "="
    echo "🚀 RUNNING BULK UPSERT TESTS"
    echo "="
    
    # Test 1: Basic CSV import
    test_bulk_upsert "products.csv" "$TEST_TABLE" "" "Basic CSV Import"
    verify_data 5 "5 products imported"
    
    # Test 2: JSON array import
    test_bulk_upsert "products.json" "$TEST_TABLE" "sku" "JSON Array Import (with upsert)"
    verify_data 8 "3 new products added"
    
    # Test 3: Single JSON object
    test_bulk_upsert "single-product.json" "$TEST_TABLE" "sku" "Single JSON Object"
    verify_data 9 "1 product added"
    
    # Test 4: CSV with special characters
    test_bulk_upsert "special-chars.csv" "$TEST_TABLE" "sku" "Special Characters in CSV"
    verify_data 13 "4 products with special chars"
    
    # Test 5: Upsert test (update existing)
    test_bulk_upsert "upsert-test.csv" "$TEST_TABLE" "sku" "Upsert - Update Existing"
    verify_data 14 "1 new product, 2 updated"
    check_data "SELECT name, price FROM $TEST_TABLE WHERE sku='PROD-001'" "Updated Laptop" "PROD-001 was updated"
    
    # Test 6: NULL values handling
    test_bulk_upsert "null-values.csv" "$TEST_TABLE" "sku" "NULL Values in CSV"
    verify_data 18 "4 products with nulls"
    
    # Test 7: Unicode/Emoji support
    test_bulk_upsert "unicode.csv" "$TEST_TABLE" "sku" "Unicode and Emoji Support"
    verify_data 22 "4 unicode products"
    check_data "SELECT name FROM $TEST_TABLE WHERE sku='UNI-004'" "🚀 Rocket Toy" "Emoji preserved"
    
    # Test 8: Error handling - empty file
    echo ""
    echo "🧪 Test: Error Handling - Empty CSV"
    echo "   File: empty.csv"
    if test_bulk_upsert "empty.csv" "$TEST_TABLE" "" "Empty CSV (should fail)" true; then
        echo "   ❌ ERROR: Empty file was accepted (should have been rejected)"
    else
        echo "   ✅ Correctly rejected empty file (expected behavior)"
    fi
    
    # Test 9: Error handling - invalid CSV
    echo ""
    echo "🧪 Test: Error Handling - Invalid CSV"
    echo "   File: invalid.csv"
    if test_bulk_upsert "invalid.csv" "$TEST_TABLE" "" "Invalid CSV (should fail)" true; then
        echo "   ❌ ERROR: Invalid CSV was accepted (should have been rejected)"
    else
        echo "   ✅ Correctly rejected invalid CSV (expected behavior)"
    fi
    
    # Test 10: Performance test
    echo ""
    echo "🧪 Test: Large Dataset Performance"
    START_TIME=$(date +%s%N)
    test_bulk_upsert "large-dataset.csv" "$TEST_TABLE" "sku" "1000 rows bulk insert"
    END_TIME=$(date +%s%N)
    ELAPSED=$((($END_TIME - $START_TIME) / 1000000))
    echo "   ⏱️  Time: ${ELAPSED}ms ($(echo "scale=1; 1000000/$ELAPSED" | bc) rows/sec)"
    
    echo ""
    echo "="
    echo "📊 TEST SUMMARY"
    echo "="
    
    # Final verification
    local final_count=$(curl -s -X POST "$API_BASE/database/advance/rawsql" \
        -H "Authorization: Bearer $AUTH_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"query\": \"SELECT COUNT(*) as count FROM $TEST_TABLE\"}" | grep -o '"count":"[0-9]*' | cut -d'"' -f4)
    
    echo "Total records in table: $final_count"
    echo ""
    
    # Cleanup
    cleanup
    
    echo ""
    echo "✅ All bulk upsert tests completed!"
}

# Trap to ensure cleanup on exit
trap cleanup EXIT

# Run the tests
main