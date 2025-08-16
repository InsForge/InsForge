#!/bin/bash

# Universal test runner for Insforge backend tests
# This script runs all test files in the tests directory

# Don't exit on error - we want to run all tests even if some fail
# set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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

# Check if API key is set
if [ -z "$ACCESS_API_KEY" ]; then
    echo -e "${YELLOW}Warning: ACCESS_API_KEY not set. Some tests may fail.${NC}"
    echo "Set with: export ACCESS_API_KEY=your_api_key"
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