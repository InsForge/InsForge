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
- Root admin credentials should be configured in environment variables:
  - `ROOT_ADMIN_USERNAME` (default: admin)
  - `ROOT_ADMIN_PASSWORD` (default: change-this-password)

### Example Commands

```bash
# Run from the backend directory
cd backend

# Run Better Auth test
./tests/manual/test-better-auth.sh

# Run with custom root admin credentials
ROOT_ADMIN_USERNAME=admin ROOT_ADMIN_PASSWORD=mysecurepass ./tests/manual/test-better-auth.sh
```

### Test Coverage

The test covers:
- Admin authentication (sign-in, wrong password, wrong admin username)
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

---

## Google ID Token Sign-In Verification Tool

### test-google-id-token.html

This is a standalone, client-side HTML test helper utility to manually verify Google Sign-In and the ID Token authentication endpoint (`/api/auth/id-token?client_type=mobile`).

#### Prerequisites

- Running local InsForge backend on `http://localhost:7130`.
- A valid Google Client ID configured in your `.env` (or use the pre-configured default client ID inside the HTML file for testing).

#### How to Use

1. Serve or open `test-google-id-token.html` directly in your browser.
2. Click **"Sign in with Google"** to authenticate via Google OAuth and retrieve your raw `id_token`.
3. Once authenticated, the **"Test /api/auth/id-token"** button will be enabled. Click it to transmit the token to your local backend API.
4. The backend response will print directly in the results console showing either a successful authentication profile or validation error.
