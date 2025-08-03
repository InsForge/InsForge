# Manual Tests

This directory contains tests that need to be run manually and are not included in the automated test suite.

## Better Auth Tests

These tests are for the Better Auth v2 implementation and require `ENABLE_BETTER_AUTH=true` to be set.

### Running Better Auth Tests

Run the Better Auth test:
```bash
ENABLE_BETTER_AUTH=true ./tests/manual/test-better-auth.sh
```

### Prerequisites

- Docker must be running with the InsForge backend on port 7130
- `ENABLE_BETTER_AUTH=true` must be set in the environment
- Admin credentials should be configured in environment variables:
  - `ADMIN_EMAIL` (default: admin@example.com)
  - `ADMIN_PASSWORD` (default: change-this-password)

### Example Commands

```bash
# Run from the backend directory
cd backend

# Run Better Auth test
ENABLE_BETTER_AUTH=true ./tests/manual/test-better-auth.sh

# Run with custom admin credentials
ADMIN_EMAIL=admin@mycompany.com ADMIN_PASSWORD=mysecurepass ENABLE_BETTER_AUTH=true ./tests/manual/test-better-auth.sh
```

### Test Coverage

The test covers:
- Admin authentication (sign-in, wrong password, non-admin email)
- User registration and sign-in
- Admin user management (list users with pagination)
- JWT token verification (admin role and type claims)
- Authorization checks (admin-only endpoints)
- Error handling (invalid email format, missing fields)

### Why These Tests Are Manual

These tests are kept separate because:
1. They require Better Auth to be enabled, which is not the default
2. They use different authentication endpoints (`/api/auth/v2/*`) than the regular tests
3. They need to be run independently during the Better Auth migration phase
4. They don't interfere with the existing test suite that uses the old auth system

Once Better Auth becomes the default authentication system, these tests can be moved back to the automated test suite.