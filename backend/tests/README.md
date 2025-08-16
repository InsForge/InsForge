# Insforge Backend Tests

This directory contains all test scripts for the Insforge backend.

## Prerequisites

- Backend server running on `http://localhost:7130`
- Admin credentials: `admin@example.com` / `change-this-password`
- API key for storage operations

## Environment Variables

Set these before running tests:

```bash
# Required for API authentication
export ACCESS_API_KEY="your_api_key_here"

# Optional - defaults shown
export ADMIN_EMAIL="admin@example.com"
export ADMIN_PASSWORD="change-this-password"
export TEST_API_BASE="http://localhost:7130/api"

# Required for cloud/S3 tests
export AWS_S3_BUCKET="your-s3-bucket"
export AWS_REGION="us-east-1"
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export APP_KEY="app12345"  # 7-9 character tenant identifier
```

## Test Organization

Tests are organized into two categories:

### Local Tests (`./local/`)
Tests for local Docker deployment with local file storage:
- `test-auth-router.sh` - Authentication and JWT tests
- `test-database-router.sh` - Database CRUD operations
- `test-e2e.sh` - End-to-end workflows
- `test-public-bucket.sh` - Local storage bucket tests
- `test-config.sh` - Configuration management
- `test-oauth-config.sh` - OAuth configuration
- `comprehensive-curl-tests.sh` - Comprehensive API tests

### Cloud Tests (`./cloud/`)
Tests for cloud deployment with S3 multi-tenant storage:
- `test-s3-multitenant.sh` - S3 storage with APP_KEY folder structure

## Running Tests

### Run all tests
```bash
./run-all-tests.sh
```

### Run local tests only
```bash
cd local && for test in test-*.sh; do ./$test; done
```

### Run cloud tests only
```bash
cd cloud && for test in test-*.sh; do ./$test; done
```

### Run individual test
```bash
./local/test-auth-router.sh
./cloud/test-s3-multitenant.sh
```

## Test Data Cleanup

All tests automatically clean up after themselves by:
- Deleting test users (email prefix: `testuser_`)
- Removing test tables
- Deleting test storage buckets

### Manual cleanup

To remove ALL test data from the system:

```bash
./cleanup-all-test-data.sh
```

This will prompt for confirmation and then delete:
- All users with email prefix `testuser_`
- All tables containing `test_`, `temp_`, `_test`, `_temp`
- All buckets containing `test`, `temp`, `public-images-`, `private-docs-`
- All API keys with "test" in their name

## Test Configuration

All tests source `test-config.sh` which provides:
- Shared configuration and environment variables
- Color output utilities
- Automatic cleanup functions
- Error tracking

## Writing New Tests

1. Create a new shell script in the appropriate subdirectory (`local/` or `cloud/`)
2. Source the test configuration:
   ```bash
   source "$SCRIPT_DIR/test-config.sh"
   ```
3. Register resources for cleanup:
   ```bash
   register_test_user "$email"
   register_test_table "$table_name"
   register_test_bucket "$bucket_name"
   ```
4. Use utility functions:
   ```bash
   print_success "Test passed"
   print_fail "Test failed"
   print_info "Running test..."
   ```
5. Tests will automatically clean up on exit

## Authentication

- **Auth endpoints** (users, profiles): Use JWT tokens via `Authorization: Bearer $token`
- **Database endpoints**: Use JWT tokens via `Authorization: Bearer $token`
- **Storage endpoints**: Use API keys via `x-api-key: $api_key`

## Exit Codes

- `0`: All tests passed
- `1`: One or more tests failed

Tests track failures and return appropriate exit codes for CI/CD integration.