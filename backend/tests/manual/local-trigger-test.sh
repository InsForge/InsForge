#!/bin/bash

# =============================================================================
# Local Trigger Test - Run SQL commands and observe memory in watch terminal
# =============================================================================

source "$(dirname "$0")/../test-config.sh"

API_BASE="${TEST_API_BASE:-http://localhost:7130/api}"

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  LOCAL TRIGGER TEST${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "API: $API_BASE"
echo ""

# Get admin token
echo "Getting admin token..."
ADMIN_TOKEN=$(get_admin_token)
if [ -z "$ADMIN_TOKEN" ]; then
    print_fail "Could not get admin token. Is the backend running?"
    exit 1
fi
print_success "Got admin token"
echo ""

# Function to run SQL
run_sql() {
    local name="$1"
    local query="$2"

    echo -e "${YELLOW}▶ $name${NC}"
    echo "  Query: ${query:0:60}..."

    local start=$(date +%s%3N)
    local response=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/database/advance/rawsql" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -d "{\"query\": \"$query\"}" 2>&1)
    local end=$(date +%s%3N)
    local duration=$((end - start))

    local http_code=$(echo "$response" | tail -1)

    if [ "$http_code" = "200" ]; then
        echo -e "  ${GREEN}✓ Success${NC} (${duration}ms)"
    else
        echo -e "  ${RED}✗ Failed (HTTP $http_code)${NC} (${duration}ms)"
    fi
    echo ""
}

# Function to trigger schema fetch
fetch_schemas() {
    echo -e "${YELLOW}▶ Fetching all table schemas (simulates dashboard)${NC}"

    local start=$(date +%s%3N)
    local response=$(curl -s -w "\n%{http_code}" -X GET "$API_BASE/database/tables/schemas" \
        -H "Authorization: Bearer $ADMIN_TOKEN" 2>&1)
    local end=$(date +%s%3N)
    local duration=$((end - start))

    local http_code=$(echo "$response" | tail -1)

    if [ "$http_code" = "200" ]; then
        echo -e "  ${GREEN}✓ Success${NC} (${duration}ms)"
    else
        echo -e "  ${RED}✗ Failed (HTTP $http_code)${NC} (${duration}ms)"
    fi
    echo ""
}

# Count tables
TABLE_COUNT=$(curl -s "$API_BASE/database/tables" -H "Authorization: Bearer $ADMIN_TOKEN" | grep -o '"[^"]*"' | wc -l)
echo "Current tables in database: ~$TABLE_COUNT"
echo ""

# Menu
echo "═══════════════════════════════════════════════════════════════"
echo "  Choose a test (watch memory in the other terminal!)"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  1) Simple DDL - CREATE TABLE"
echo "  2) Complex DDL - CREATE TABLE + RLS"
echo "  3) Multi-statement DDL - 3 tables at once"
echo "  4) Schema fetch only - getAllTableSchemas()"
echo "  5) DDL + immediate schema fetch (worst case)"
echo "  6) The exact query that crashes EC2"
echo "  7) Run all tests sequentially"
echo "  8) Cleanup test tables"
echo "  0) Exit"
echo ""
read -p "Choice: " CHOICE

case $CHOICE in
    1)
        echo ""
        echo ">>> Watch the memory terminal! Running in 3 seconds..."
        sleep 3
        run_sql "Simple DDL" "CREATE TABLE IF NOT EXISTS _test_simple (id uuid primary key default gen_random_uuid());"
        ;;
    2)
        echo ""
        echo ">>> Watch the memory terminal! Running in 3 seconds..."
        sleep 3
        run_sql "Complex DDL" "CREATE TABLE IF NOT EXISTS _test_complex (id uuid primary key, user_id uuid not null, data jsonb, created_at timestamptz default now()); ALTER TABLE _test_complex ENABLE ROW LEVEL SECURITY;"
        ;;
    3)
        echo ""
        echo ">>> Watch the memory terminal! Running in 3 seconds..."
        sleep 3
        run_sql "Multi-statement" "CREATE TABLE IF NOT EXISTS _test_a (id uuid primary key); CREATE TABLE IF NOT EXISTS _test_b (id uuid primary key); CREATE TABLE IF NOT EXISTS _test_c (id uuid primary key);"
        ;;
    4)
        echo ""
        echo ">>> Watch the memory terminal! Running in 3 seconds..."
        sleep 3
        fetch_schemas
        ;;
    5)
        echo ""
        echo ">>> Watch the memory terminal! Running in 3 seconds..."
        sleep 3
        run_sql "DDL" "CREATE TABLE IF NOT EXISTS _test_cascade (id uuid primary key default gen_random_uuid());"
        echo "Immediately fetching schemas..."
        fetch_schemas
        ;;
    6)
        echo ""
        echo ">>> This is the EXACT query that crashes EC2"
        echo ">>> Watch the memory terminal! Running in 3 seconds..."
        sleep 3

        CRASH_QUERY="create extension if not exists \\\"uuid-ossp\\\"; create table if not exists public._test_workouts (id uuid primary key, user_id uuid not null, start_date date not null, duration_sec int not null, calories numeric, avg_hr numeric, max_hr numeric, device_type text, created_at timestamptz default now(), unique(user_id, start_date, id)); create table if not exists public._test_workout_metrics (workout_id uuid primary key references public._test_workouts(id) on delete cascade, zone_times_sec jsonb not null, hiita_scores jsonb not null, updated_at timestamptz default now()); alter table public._test_workouts enable row level security; alter table public._test_workout_metrics enable row level security;"

        run_sql "EC2 Crash Query" "$CRASH_QUERY"
        ;;
    7)
        echo ""
        echo ">>> Running all tests with 5 second gaps"
        echo ">>> Watch the memory terminal!"
        sleep 3

        echo "--- TEST 1: Simple DDL ---"
        run_sql "Simple DDL" "CREATE TABLE IF NOT EXISTS _test_simple (id uuid primary key default gen_random_uuid());"
        sleep 5

        echo "--- TEST 2: Schema fetch ---"
        fetch_schemas
        sleep 5

        echo "--- TEST 3: Complex DDL ---"
        run_sql "Complex DDL" "CREATE TABLE IF NOT EXISTS _test_complex (id uuid primary key, user_id uuid not null, created_at timestamptz default now()); ALTER TABLE _test_complex ENABLE ROW LEVEL SECURITY;"
        sleep 5

        echo "--- TEST 4: Schema fetch again ---"
        fetch_schemas
        sleep 5

        echo "--- TEST 5: DDL + immediate fetch ---"
        run_sql "DDL" "CREATE TABLE IF NOT EXISTS _test_cascade (id uuid primary key);"
        fetch_schemas

        echo "--- DONE ---"
        ;;
    8)
        echo ""
        echo "Cleaning up test tables..."
        run_sql "Cleanup" "DROP TABLE IF EXISTS _test_simple, _test_complex, _test_a, _test_b, _test_c, _test_cascade, _test_workouts, _test_workout_metrics CASCADE;"
        ;;
    0)
        echo "Bye!"
        exit 0
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "Done! Check the memory watch terminal to see what happened."
