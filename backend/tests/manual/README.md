# Manual Tests

This directory contains tests that need to be run manually and are not included in the automated test suite.

## Better Auth Tests

These tests are for the Better Auth v2 implementation.

### Running Better Auth Tests

Run the Better Auth test:

```bash
./tests/manual/test-better-auth.sh
```

### Prerequisites

- Docker must be running with the InsForge backend on port 7130
- Admin credentials should be configured in environment variables:
  - `ADMIN_EMAIL` (default: admin@example.com)
  - `ADMIN_PASSWORD` (default: change-this-password)

### Example Commands

```bash
# Run from the backend directory
cd backend

# Run Better Auth test
./tests/manual/test-better-auth.sh

# Run with custom admin credentials
ADMIN_EMAIL=admin@mycompany.com ADMIN_PASSWORD=mysecurepass ./tests/manual/test-better-auth.sh
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

1. They use authentication endpoints (`/api/auth/v2/*`) that require specific setup
2. They test admin-specific functionality that needs manual verification
3. They verify JWT token structure and claims that may vary between environments
