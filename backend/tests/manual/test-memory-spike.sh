#!/bin/bash

# =============================================================================
# Memory Spike Diagnostic Script
# =============================================================================
# This script helps identify what causes memory spikes on EC2 nano (500MB)
# Run this against your EC2 instance to diagnose the issue
# =============================================================================

set -e

# Configuration - UPDATE THESE
EC2_HOST="${EC2_HOST:-your-ec2-host.amazonaws.com}"
EC2_USER="${EC2_USER:-ec2-user}"
EC2_KEY="${EC2_KEY:-~/.ssh/your-key.pem}"
API_BASE="${API_BASE:-http://localhost:7130/api}"
ADMIN_TOKEN="${ADMIN_TOKEN:-your-admin-token}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Test SQL queries
SIMPLE_DDL='{"query": "CREATE TABLE IF NOT EXISTS _test_mem_simple (id uuid primary key default gen_random_uuid());"}'

COMPLEX_DDL='{"query": "CREATE TABLE IF NOT EXISTS _test_mem_workouts (id uuid primary key, user_id uuid not null, start_date date not null, duration_sec int not null, calories numeric, created_at timestamptz default now()); ALTER TABLE _test_mem_workouts ENABLE ROW LEVEL SECURITY;"}'

MULTI_STATEMENT_DDL='{"query": "CREATE TABLE IF NOT EXISTS _test_mem_a (id uuid primary key); CREATE TABLE IF NOT EXISTS _test_mem_b (id uuid primary key); CREATE TABLE IF NOT EXISTS _test_mem_c (id uuid primary key);"}'

CLEANUP_SQL='{"query": "DROP TABLE IF EXISTS _test_mem_simple, _test_mem_workouts, _test_mem_a, _test_mem_b, _test_mem_c CASCADE;"}'

# =============================================================================
# Helper Functions
# =============================================================================

print_header() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

print_test() {
    echo -e "${BLUE}▶ TEST: $1${NC}"
}

print_result() {
    echo -e "${GREEN}  ✓ $1${NC}"
}

print_warn() {
    echo -e "${YELLOW}  ⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}  ✗ $1${NC}"
}

print_info() {
    echo -e "  $1"
}

# Get memory from local machine (for local testing)
get_local_memory() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        local page_size=$(pagesize)
        local free_pages=$(vm_stat | grep "Pages free" | awk '{print $3}' | tr -d '.')
        local inactive_pages=$(vm_stat | grep "Pages inactive" | awk '{print $3}' | tr -d '.')
        echo "$(( (free_pages + inactive_pages) * page_size / 1024 / 1024 ))MB free (macOS)"
    else
        # Linux
        free -m | awk 'NR==2{printf "%sMB used, %sMB free, %sMB available", $3, $4, $7}'
    fi
}

# Get memory from EC2 via SSH
get_ec2_memory() {
    if [ -f "$EC2_KEY" ] && [ "$EC2_HOST" != "your-ec2-host.amazonaws.com" ]; then
        ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
            "$EC2_USER@$EC2_HOST" "free -m | awk 'NR==2{printf \"%sMB used, %sMB free, %sMB avail\", \$3, \$4, \$7}'" 2>/dev/null || echo "SSH failed"
    else
        echo "EC2 not configured"
    fi
}

# Get Node.js process memory
get_node_memory() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        ps -o rss= -p $(pgrep -f "node.*server" | head -1) 2>/dev/null | awk '{printf "%.1fMB", $1/1024}' || echo "N/A"
    else
        ps -o rss= -p $(pgrep -f "node.*server" | head -1) 2>/dev/null | awk '{printf "%.1fMB", $1/1024}' || echo "N/A"
    fi
}

# Run SQL and measure time
run_sql() {
    local name="$1"
    local body="$2"
    local start_time=$(date +%s%3N)

    local response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/database/advance/rawsql" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -d "$body" 2>&1)

    local end_time=$(date +%s%3N)
    local duration=$((end_time - start_time))
    local http_code=$(echo "$response" | tail -1)
    local body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        print_result "$name completed in ${duration}ms"
    else
        print_error "$name failed (HTTP $http_code) in ${duration}ms"
        echo "$body" | head -3
    fi

    echo "$http_code"
}

# Trigger table schemas fetch (simulates dashboard refetch)
trigger_schemas_fetch() {
    local start_time=$(date +%s%3N)

    local response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/database/tables/schemas" \
        -H "Authorization: Bearer $ADMIN_TOKEN" 2>&1)

    local end_time=$(date +%s%3N)
    local duration=$((end_time - start_time))
    local http_code=$(echo "$response" | tail -1)

    if [ "$http_code" = "200" ]; then
        print_result "Schemas fetch completed in ${duration}ms"
    else
        print_error "Schemas fetch failed (HTTP $http_code)"
    fi
}

# =============================================================================
# Diagnostic Tests
# =============================================================================

print_header "MEMORY SPIKE DIAGNOSTIC TOOL"

echo "Configuration:"
echo "  API_BASE: $API_BASE"
echo "  EC2_HOST: $EC2_HOST"
echo ""

# -----------------------------------------------------------------------------
# Test 0: Baseline Memory
# -----------------------------------------------------------------------------
print_header "TEST 0: BASELINE MEMORY"

print_test "Checking current memory state"
print_info "Local memory: $(get_local_memory)"
print_info "Node.js RSS: $(get_node_memory)"
print_info "EC2 memory:  $(get_ec2_memory)"

# Count existing tables
TABLE_COUNT=$(curl -s -X GET "$API_BASE/database/tables" \
    -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null | grep -o '"[^"]*"' | grep -v '\[' | grep -v '\]' | wc -l | tr -d ' ')
print_info "Existing tables: $TABLE_COUNT"

echo ""
read -p "Press Enter to continue with tests..."

# -----------------------------------------------------------------------------
# Test 1: Simple DDL (No Cascade)
# -----------------------------------------------------------------------------
print_header "TEST 1: SIMPLE DDL - Single CREATE TABLE"

print_test "Memory BEFORE simple DDL"
print_info "Node.js RSS: $(get_node_memory)"
BEFORE_MEM=$(get_node_memory)

print_test "Running simple CREATE TABLE"
run_sql "Simple DDL" "$SIMPLE_DDL"

sleep 1

print_test "Memory AFTER simple DDL (wait 1s)"
print_info "Node.js RSS: $(get_node_memory)"
AFTER_MEM=$(get_node_memory)

print_info "Memory change: $BEFORE_MEM -> $AFTER_MEM"

# -----------------------------------------------------------------------------
# Test 2: DDL + Immediate Schema Fetch (Simulate Dashboard)
# -----------------------------------------------------------------------------
print_header "TEST 2: DDL + SCHEMA FETCH (Simulates Dashboard Refetch)"

print_test "Memory BEFORE"
print_info "Node.js RSS: $(get_node_memory)"
BEFORE_MEM=$(get_node_memory)

print_test "Running DDL then immediately fetching all schemas"
run_sql "Complex DDL" "$COMPLEX_DDL"
trigger_schemas_fetch

sleep 1

print_test "Memory AFTER DDL + schema fetch"
print_info "Node.js RSS: $(get_node_memory)"
AFTER_MEM=$(get_node_memory)

print_info "Memory change: $BEFORE_MEM -> $AFTER_MEM"

# -----------------------------------------------------------------------------
# Test 3: Concurrent Requests (2 DDLs back-to-back)
# -----------------------------------------------------------------------------
print_header "TEST 3: CONCURRENT DDLs (Back-to-back)"

print_test "Memory BEFORE"
print_info "Node.js RSS: $(get_node_memory)"
BEFORE_MEM=$(get_node_memory)

print_test "Running 2 DDLs concurrently (background jobs)"

# Run both in background
(curl -s -X POST "$API_BASE/database/advance/rawsql" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{"query": "SELECT pg_sleep(0.1); CREATE TABLE IF NOT EXISTS _test_concurrent_1 (id uuid primary key);"}' > /dev/null 2>&1) &
PID1=$!

(curl -s -X POST "$API_BASE/database/advance/rawsql" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{"query": "SELECT pg_sleep(0.1); CREATE TABLE IF NOT EXISTS _test_concurrent_2 (id uuid primary key);"}' > /dev/null 2>&1) &
PID2=$!

# Monitor memory while requests run
for i in 1 2 3; do
    sleep 0.3
    print_info "  ... Node.js RSS: $(get_node_memory)"
done

wait $PID1 $PID2
print_result "Both DDLs completed"

print_test "Memory AFTER concurrent DDLs"
print_info "Node.js RSS: $(get_node_memory)"
AFTER_MEM=$(get_node_memory)

print_info "Memory change: $BEFORE_MEM -> $AFTER_MEM"

# Cleanup concurrent test tables
curl -s -X POST "$API_BASE/database/advance/rawsql" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{"query": "DROP TABLE IF EXISTS _test_concurrent_1, _test_concurrent_2;"}' > /dev/null 2>&1

# -----------------------------------------------------------------------------
# Test 4: DDL + Concurrent Schema Fetch (Worst Case)
# -----------------------------------------------------------------------------
print_header "TEST 4: DDL + CONCURRENT SCHEMA FETCH (Worst Case)"

print_test "Memory BEFORE"
print_info "Node.js RSS: $(get_node_memory)"
BEFORE_MEM=$(get_node_memory)

print_test "Running DDL + 3 concurrent schema fetches"

# DDL in background
(curl -s -X POST "$API_BASE/database/advance/rawsql" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d "$MULTI_STATEMENT_DDL" > /dev/null 2>&1) &

# Multiple schema fetches (simulating multiple dashboard tabs or rapid refetches)
(curl -s -X GET "$API_BASE/database/tables/schemas" \
    -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null 2>&1) &
(curl -s -X GET "$API_BASE/database/tables/schemas" \
    -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null 2>&1) &
(curl -s -X GET "$API_BASE/database/tables/schemas" \
    -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null 2>&1) &

# Monitor memory
print_info "Monitoring memory during concurrent operations:"
for i in 1 2 3 4 5; do
    sleep 0.5
    print_info "  ${i}. Node.js RSS: $(get_node_memory)"
done

wait
print_result "All operations completed"

print_test "Memory AFTER worst case test"
print_info "Node.js RSS: $(get_node_memory)"
AFTER_MEM=$(get_node_memory)

print_info "Memory change: $BEFORE_MEM -> $AFTER_MEM"

# -----------------------------------------------------------------------------
# Test 5: Schema Fetch Only (Cascade Measurement)
# -----------------------------------------------------------------------------
print_header "TEST 5: SCHEMA FETCH ONLY (Measure Cascade Cost)"

NEW_TABLE_COUNT=$(curl -s -X GET "$API_BASE/database/tables" \
    -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null | grep -o '"[^"]*"' | grep -v '\[' | grep -v '\]' | wc -l | tr -d ' ')
print_info "Current table count: $NEW_TABLE_COUNT"

print_test "Memory BEFORE schema fetch"
print_info "Node.js RSS: $(get_node_memory)"
BEFORE_MEM=$(get_node_memory)

print_test "Fetching all table schemas..."
START_TIME=$(date +%s%3N)
trigger_schemas_fetch
END_TIME=$(date +%s%3N)
DURATION=$((END_TIME - START_TIME))

print_test "Memory AFTER schema fetch"
print_info "Node.js RSS: $(get_node_memory)"
AFTER_MEM=$(get_node_memory)

print_info "Schema fetch for $NEW_TABLE_COUNT tables took ${DURATION}ms"
print_info "Memory change: $BEFORE_MEM -> $AFTER_MEM"

# Estimate per-table cost
if [ "$NEW_TABLE_COUNT" -gt 0 ]; then
    print_info "Estimated cost per table: $((DURATION / NEW_TABLE_COUNT))ms"
fi

# -----------------------------------------------------------------------------
# Cleanup
# -----------------------------------------------------------------------------
print_header "CLEANUP"

print_test "Removing test tables"
run_sql "Cleanup" "$CLEANUP_SQL"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
print_header "DIAGNOSIS SUMMARY"

echo "Based on the tests above, check:"
echo ""
echo "1. If TEST 1 (simple DDL) shows big memory jump:"
echo "   → Issue is in SQL execution itself"
echo ""
echo "2. If TEST 2 shows bigger jump than TEST 1:"
echo "   → WebSocket cascade is adding overhead"
echo ""
echo "3. If TEST 3 (concurrent) shows spike:"
echo "   → Concurrent requests are piling up"
echo ""
echo "4. If TEST 4 (worst case) crashes or times out:"
echo "   → Multiple cascades + DDL = too much for 500MB"
echo ""
echo "5. If TEST 5 (schema fetch only) is slow or spikes:"
echo "   → getAllTableSchemas() is the bottleneck"
echo ""
echo -e "${YELLOW}Recommendation for 500MB instances:${NC}"
echo "  - Limit concurrent connections"
echo "  - Debounce WebSocket-triggered refetches"
echo "  - Use approximate row counts instead of COUNT(*)"
echo "  - Or upgrade to t2.micro (1GB) minimum"
echo ""
