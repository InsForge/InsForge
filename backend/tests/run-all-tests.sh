#!/bin/bash

# Universal test runner for Insforge backend tests
# This script runs all test files in the tests directory

# Don't exit on error - we want to run all tests even if some fail
# set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PREFLIGHT_ONLY=0

for arg in "$@"; do
    case "$arg" in
        --preflight-only)
            PREFLIGHT_ONLY=1
            ;;
        -h|--help)
            echo "Usage: $0 [--preflight-only]"
            echo ""
            echo "Options:"
            echo "  --preflight-only  Check local E2E prerequisites, then exit."
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $arg${NC}"
            echo "Usage: $0 [--preflight-only]"
            exit 1
            ;;
    esac
done

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# PROJECT_ROOT is the repository root, not just the backend directory
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
BACKEND_ROOT="$(dirname "$SCRIPT_DIR")"

# Load environment from .env file if it exists
if [ -f "$PROJECT_ROOT/.env" ]; then
    echo "Loading environment from .env file..."
    set -a  # automatically export all variables
    source "$PROJECT_ROOT/.env"
    set +a  # turn off automatic export
fi

echo "=========================================="
echo "Running all Insforge backend tests"
echo "=========================================="
echo ""

# Export API configuration for all tests
export TEST_API_BASE="${TEST_API_BASE:-http://localhost:7130/api}"

# Check if admin credentials are set
if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; then
    echo -e "${YELLOW}Warning: Admin credentials not set. Using defaults.${NC}"
    echo "Set with: export ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=your_password"
    export ADMIN_EMAIL="admin@example.com"
    export ADMIN_PASSWORD="change-this-password"
    echo ""
fi

# Check if running cloud tests
if [ -z "$AWS_S3_BUCKET" ]; then
    echo -e "${YELLOW}Note: AWS_S3_BUCKET not set. Cloud/S3 tests will be skipped.${NC}"
    echo ""
fi

# Export admin credentials for tests
export TEST_ADMIN_EMAIL="$ADMIN_EMAIL"
export TEST_ADMIN_PASSWORD="$ADMIN_PASSWORD"

print_setup_help() {
    echo ""
    echo -e "${BLUE}Local setup:${NC}"
    echo "  cp .env.example .env"
    echo "  docker compose -f docker-compose.prod.yml up"
    echo ""
    echo "Then rerun:"
    echo "  npm run test:e2e"
    echo ""
    echo "If your backend runs elsewhere, set:"
    echo "  export TEST_API_BASE=http://localhost:7130/api"
    echo "  export ADMIN_EMAIL=admin@example.com"
    echo "  export ADMIN_PASSWORD=change-this-password"
    echo "  export ACCESS_API_KEY=ik_..."
}

extract_json_value() {
    local json="$1"
    local key="$2"

    if command -v jq >/dev/null 2>&1; then
        echo "$json" | jq -r --arg key "$key" '.[$key] // empty' 2>/dev/null
        return
    fi

    echo "$json" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

json_escape() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//$'\n'/\\n}"
    value="${value//$'\r'/\\r}"
    value="${value//$'\t'/\\t}"
    echo "$value"
}

build_admin_login_body() {
    if command -v jq >/dev/null 2>&1; then
        jq -n --arg email "$TEST_ADMIN_EMAIL" --arg password "$TEST_ADMIN_PASSWORD" \
            '{email: $email, password: $password}'
        return
    fi

    local escaped_email
    local escaped_password
    escaped_email=$(json_escape "$TEST_ADMIN_EMAIL")
    escaped_password=$(json_escape "$TEST_ADMIN_PASSWORD")
    printf '{"email":"%s","password":"%s"}' "$escaped_email" "$escaped_password"
}

get_admin_token() {
    local body
    local response
    body=$(build_admin_login_body)
    response=$(curl -sS -X POST "$TEST_API_BASE/auth/admin/sessions" \
        -H "Content-Type: application/json" \
        -d "$body" 2>/dev/null)

    extract_json_value "$response" "accessToken"
}

get_api_key_from_metadata() {
    local admin_token="$1"
    local response
    response=$(curl -sS "$TEST_API_BASE/metadata/api-key" \
        -H "Authorization: Bearer $admin_token" 2>/dev/null)

    extract_json_value "$response" "apiKey"
}

run_preflight() {
    echo -e "${YELLOW}=== Running E2E Preflight ===${NC}"

    if ! command -v curl >/dev/null 2>&1; then
        echo -e "${RED}Preflight failed: curl is required but was not found.${NC}"
        return 1
    fi

    local health_response
    local health_status
    health_response=$(curl -sS -w "\n%{http_code}" "$TEST_API_BASE/health" 2>/dev/null)
    health_status=$(echo "$health_response" | tail -n 1)

    if [ "$health_status" != "200" ]; then
        echo -e "${RED}Preflight failed: backend health check did not return 200.${NC}"
        echo "Checked: $TEST_API_BASE/health"
        echo "Status: ${health_status:-unreachable}"
        print_setup_help
        return 1
    fi

    echo -e "${GREEN}✓ Backend health check passed${NC}"

    local admin_token
    admin_token=$(get_admin_token)

    if [ -z "$admin_token" ]; then
        echo -e "${RED}Preflight failed: admin login did not return an access token.${NC}"
        echo "Checked: $TEST_API_BASE/auth/admin/sessions"
        echo "Admin email: $TEST_ADMIN_EMAIL"
        print_setup_help
        return 1
    fi

    echo -e "${GREEN}✓ Admin login passed${NC}"

    local resolved_api_key="${TEST_API_KEY:-${ACCESS_API_KEY:-}}"

    if [ -z "$resolved_api_key" ]; then
        resolved_api_key=$(get_api_key_from_metadata "$admin_token")
    fi

    if [ -z "$resolved_api_key" ]; then
        echo -e "${RED}Preflight failed: no API key was available.${NC}"
        echo "Set TEST_API_KEY or ACCESS_API_KEY, or ensure /metadata/api-key works for the admin session."
        print_setup_help
        return 1
    fi

    export ACCESS_API_KEY="$resolved_api_key"
    echo -e "${GREEN}✓ API key is available${NC}"

    echo -e "${GREEN}Preflight passed.${NC}"
    echo ""
    return 0
}

if ! run_preflight; then
    exit 1
fi

if [ "$PREFLIGHT_ONLY" -eq 1 ]; then
    exit 0
fi

# Keep track of test results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
FAILED_TEST_NAMES=()

# Function to run a test and handle cleanup
run_test() {
    local test_script=$1
    local test_name=$(basename "$test_script" .sh)
    
    echo -e "${YELLOW}Running $test_name...${NC}"
    echo "----------------------------------------"
    
    # Run the test in a subshell to isolate cleanup
    (
        # Run the test script
        "$test_script"
    )
    
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}✓ $test_name passed${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}✗ $test_name failed${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        FAILED_TEST_NAMES+=("$test_name")
    fi
    
    echo ""
    # Don't return the exit code - we want to continue running other tests
    return 0
}

# Run local tests
echo -e "${YELLOW}=== Running Local Tests ===${NC}"
for test_script in "$SCRIPT_DIR"/local/test-*.sh; do
    if [ -f "$test_script" ] && [ -x "$test_script" ]; then
        TOTAL_TESTS=$((TOTAL_TESTS + 1))
        run_test "$test_script"
    fi
done

# Run cloud tests if AWS is configured
if [ -n "$AWS_S3_BUCKET" ] && [ -n "$APP_KEY" ]; then
    echo -e "${YELLOW}=== Running Cloud Tests ===${NC}"
    for test_script in "$SCRIPT_DIR"/cloud/test-*.sh; do
        if [ -f "$test_script" ] && [ -x "$test_script" ]; then
            TOTAL_TESTS=$((TOTAL_TESTS + 1))
            run_test "$test_script"
        fi
    done
else
    echo -e "${YELLOW}Skipping cloud tests (AWS_S3_BUCKET or APP_KEY not configured)${NC}"
fi

# Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "Total tests: $TOTAL_TESTS"
echo -e "Passed: ${GREEN}$PASSED_TESTS${NC}"
echo -e "Failed: ${RED}$FAILED_TESTS${NC}"

if [ $FAILED_TESTS -gt 0 ]; then
    echo ""
    echo -e "${RED}Failed tests:${NC}"
    for failed_test in "${FAILED_TEST_NAMES[@]}"; do
        echo "  - $failed_test"
    done
    exit 1
else
    echo ""
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
fi
