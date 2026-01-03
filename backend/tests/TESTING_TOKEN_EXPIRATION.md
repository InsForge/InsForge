# Testing JWT Token Expiration (15 minutes)

This guide explains how to test that the JWT token expiration change from 7 days to 15 minutes works correctly.

## What Changed

- **Access token expiration**: Changed from `7d` to `15m` in `token.manager.ts`
- **Refresh token expiration**: Still `7d` (unchanged)
- **Impact**: Access tokens now expire after 15 minutes, requiring refresh token flow for long sessions

## Testing Methods

### Method 1: Run Unit Tests (Recommended)

Run the automated unit tests that verify token expiration:

```bash
cd backend
npm test -- token-expiration
```

**What it tests:**
- ✅ Access tokens are generated with 15 minute expiration
- ✅ Valid tokens work correctly
- ✅ ✅ Expired tokens are rejected
- ✅ Refresh tokens work correctly
- ✅ Token refresh flow generates new access tokens
- ✅ CSRF token generation and verification
- ✅ Token security (algorithm, claims)

### Method 2: Manual API Testing

Test the actual API endpoints:

#### Prerequisites
- Backend server running on `http://localhost:7130`
- Admin credentials configured (default: `admin@example.com` / `change-this-password`)

#### On Unix/Mac:
```bash
cd backend
./tests/manual/test-token-expiration.sh
```

#### On Windows (PowerShell):
```powershell
cd backend
# You can run the curl commands manually or use Git Bash
```

#### Manual Steps:

1. **Sign in and get tokens:**
```bash
curl -X POST http://localhost:7130/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-this-password"}'
```

2. **Use access token:**
```bash
# Extract accessToken from response, then:
curl -X GET http://localhost:7130/api/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

3. **Test refresh token flow:**
```bash
# Sign in again to get cookies (refresh token is in httpOnly cookie)
curl -c cookies.txt -X POST http://localhost:7130/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-this-password"}'

# Extract csrfToken from response, then refresh:
curl -b cookies.txt -X POST http://localhost:7130/api/auth/refresh \
  -H "X-CSRF-Token: YOUR_CSRF_TOKEN"
```

4. **Verify token expiration (after 15 minutes):**
```bash
# Wait 15+ minutes, then try using the original access token
curl -X GET http://localhost:7130/api/auth/me \
  -H "Authorization: Bearer ORIGINAL_ACCESS_TOKEN"

# Should return 401 Unauthorized
```

### Method 3: Quick Verification Script

Create a simple Node.js script to test token expiration:

```javascript
// test-token-quick.js
import { TokenManager } from './src/infra/security/token.manager.js';
import jwt from 'jsonwebtoken';

const tokenManager = TokenManager.getInstance();

// Generate token
const token = tokenManager.generateToken({
  sub: 'test-user',
  email: 'test@example.com',
  role: 'authenticated',
});

// Decode and check expiration
const decoded = jwt.decode(token, { complete: true });
const exp = decoded.payload.exp;
const iat = decoded.payload.iat;
const expirationSeconds = exp - iat;

console.log(`Token expiration: ${expirationSeconds} seconds (${expirationSeconds / 60} minutes)`);
console.log(`Expected: 900 seconds (15 minutes)`);
console.log(`✅ Test ${expirationSeconds >= 895 && expirationSeconds <= 905 ? 'PASSED' : 'FAILED'}`);
```

Run it:
```bash
cd backend
node --loader tsx test-token-quick.js
```

## What to Verify

### ✅ Must Pass:

1. **Token Generation**
   - Access tokens are generated successfully
   - Token expiration is ~15 minutes (900 seconds)

2. **Token Validation**
   - Valid tokens work for authenticated requests
   - Expired tokens are rejected with 401

3. **Refresh Flow**
   - Refresh endpoint works correctly
   - New access tokens are generated from refresh tokens
   - New tokens work for authenticated requests

4. **Security**
   - Tokens use HS256 algorithm
   - Required claims are present (sub, email, role, exp, iat)
   - CSRF protection works

### ⚠️ Edge Cases to Test:

1. **Token Expiration Timing**
   - Token works immediately after generation
   - Token expires after 15 minutes
   - Clock skew tolerance (small time differences)

2. **Refresh Token Rotation**
   - New refresh token is generated on refresh
   - Old refresh token can't be reused (if rotation is implemented)

3. **Error Handling**
   - Invalid tokens are rejected
   - Expired tokens return proper error messages
   - Missing tokens return proper error messages

## Expected Results

### ✅ Success Indicators:

- Unit tests pass: `npm test -- token-expiration` ✅
- Access tokens expire after ~15 minutes
- Refresh token flow works correctly
- No breaking changes to existing auth flows

### ❌ Failure Indicators:

- Tokens expire after 7 days (old behavior)
- Refresh token flow doesn't work
- Valid tokens are rejected
- Tests fail

## Troubleshooting

### Issue: Tests fail with "JWT_SECRET not set"
**Solution:** Set `JWT_SECRET` environment variable:
```bash
export JWT_SECRET="your-secret-key-min-32-chars"
```

### Issue: Token expiration is not 15 minutes
**Check:**
1. Verify `JWT_EXPIRES_IN = '15m'` in `token.manager.ts`
2. Restart the server after changes
3. Clear any cached tokens

### Issue: Refresh token flow fails
**Check:**
1. Refresh token cookie is being sent
2. CSRF token is included in headers
3. Refresh token hasn't expired (7 days)

## Next Steps After Testing

Once all tests pass:

1. ✅ Update the TODO comment in `token.manager.ts` (remove or mark as done)
2. ✅ Commit your changes with tests
3. ✅ Update any documentation about token expiration
4. ✅ Consider adding monitoring/alerting for token refresh failures

## Related Files

- `backend/src/infra/security/token.manager.ts` - Token generation/verification
- `backend/src/api/routes/auth/index.routes.ts` - Auth endpoints (signin, refresh)
- `backend/tests/unit/token-expiration.test.ts` - Unit tests
- `backend/tests/manual/test-token-expiration.sh` - Manual test script

