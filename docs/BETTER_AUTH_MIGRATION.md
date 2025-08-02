# Better Auth Migration Guide

## Overview
This document outlines the migration from InsForge's current authentication system to Better Auth, implementing a unified user table with role-based access control.

## Migration Status

### ✅ Completed
1. **Better Auth Setup**
   - Installed Better Auth with PostgreSQL adapter
   - Configured at `/api/auth/v2/*` with feature flag
   - Added JWT plugin with custom payload

2. **Database Schema Changes**
   - Created Better Auth tables with quoted names:
     - `"user"` - Single user table with role field
     - `"session"` - Session management
     - `"account"` - OAuth and credentials
     - `"verification"` - Email verification
     - `"jwks"` - JWT key storage

3. **Role-Based System**
   - Single `role` column replacing separate user/admin tables
   - Roles: `authenticated` (default), `dashboard_user` (admin)
   - JWT payload includes: `{ sub, email, type, role }`
   - `type` field for backward compatibility (will be removed later)

4. **Working Endpoints**
   ```bash
   # User Registration
   curl -X POST http://localhost:7130/api/auth/v2/sign-up/email \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"password123","name":"User Name"}'

   # Admin Registration (with role)
   curl -X POST http://localhost:7130/api/auth/v2/sign-up/email \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@example.com","password":"password123","name":"Admin Name","role":"dashboard_user"}'

   # Login
   curl -X POST http://localhost:7130/api/auth/v2/sign-in/email \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"password123"}'
   ```

### ✅ JWT Token Access
Better Auth JWT tokens are fully functional with the bearer plugin:

```bash
# 1. Sign in to get session token
RESPONSE=$(curl -X POST http://localhost:7130/api/auth/v2/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}')
SESSION_TOKEN=$(echo $RESPONSE | jq -r '.token')

# 2. Get JWT token using session
JWT_RESPONSE=$(curl -X GET http://localhost:7130/api/auth/v2/token \
  -H "Authorization: Bearer $SESSION_TOKEN")
JWT_TOKEN=$(echo $JWT_RESPONSE | jq -r '.token')

# 3. Use JWT for API calls
curl -X GET http://localhost:7130/api/database/records/users \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "x-api-key: YOUR_API_KEY"
```

**JWT Payload Structure:**
```json
{
  "sub": "user-id",
  "email": "user@example.com",
  "type": "user|admin",        // Backward compatibility
  "role": "authenticated|dashboard_user",  // PostgreSQL role
  "iat": 1754103302,
  "iss": "http://localhost:7130",
  "aud": "http://localhost:7130",  
  "exp": 1754708102
}
```

### 📋 TODO
1. **OAuth Providers**
   - Add Google OAuth
   - Add GitHub OAuth

2. **Session Compatibility**
   - Create middleware to support Better Auth sessions
   - Map Better Auth sessions to existing auth checks

3. **Migration Steps**
   - Update existing middleware to check Better Auth sessions
   - Migrate existing users from `_auth` to `"user"` table
   - Update all auth endpoints to use Better Auth

## Environment Configuration
```env
# Enable Better Auth (set to true to use new auth system)
ENABLE_BETTER_AUTH=true

# JWT Secret (shared between old and new system during migration)
JWT_SECRET=your-secret-key
```

## JWT Token Flow

### Complete Authentication Flow
```bash
# 1. Register new user
curl -X POST http://localhost:7130/api/auth/v2/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@example.com","password":"secure123","name":"New User"}'

# 2. Sign in and get session token
RESPONSE=$(curl -s -X POST http://localhost:7130/api/auth/v2/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@example.com","password":"secure123"}')
SESSION_TOKEN=$(echo $RESPONSE | jq -r '.token')

# 3. Exchange session for JWT
JWT_RESPONSE=$(curl -s -X GET http://localhost:7130/api/auth/v2/token \
  -H "Authorization: Bearer $SESSION_TOKEN")
JWT_TOKEN=$(echo $JWT_RESPONSE | jq -r '.token')

# 4. Use JWT for API calls (valid for 7 days)
curl -X POST http://localhost:7130/api/database/records/products \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '[{"name": "Product 1", "price": 99.99}]'
```

### JWT Verification
```bash
# Get public keys for JWT verification
curl http://localhost:7130/api/auth/v2/jwks

# Response:
{
  "keys": [{
    "alg": "EdDSA",
    "crv": "Ed25519",
    "x": "wFZvBNn2IkHvQWKtUiRRGSeP_0mLsHryDI8za0o_bt8",
    "kty": "OKP",
    "kid": "3gwljMyIYoam29k1rQmczv84kUsPTRUI"
  }]
}
```

## Technical Notes

### Express Integration
Better Auth must be mounted BEFORE `express.json()` middleware:
```javascript
// Correct order
app.all('/api/auth/v2/*', toNodeHandler(auth));
app.use(express.json());
```

### Database Considerations
- Better Auth uses quoted table names (e.g., `"user"` not `user`)
- Existing tables (`_auth`, `_superuser_auth`) remain unchanged
- Both systems can run in parallel during migration

### JWT Configuration
```javascript
plugins: [
  jwt({
    jwt: {
      expirationTime: '7d',
      definePayload: async ({ user }) => ({
        sub: user.id,
        email: user.email,
        type: user.role === 'dashboard_user' ? 'admin' : 'user',
        role: user.role || 'authenticated',
      })
    }
  })
]
```

## Migration Checklist
- [ ] Enable Better Auth flag in production
- [ ] Run database migrations to create Better Auth tables
- [ ] Test all auth endpoints
- [ ] Migrate existing users
- [ ] Update middleware to support Better Auth sessions
- [ ] Add OAuth providers
- [ ] Remove old auth code
- [ ] Update documentation

## Rollback Plan
If issues arise:
1. Set `ENABLE_BETTER_AUTH=false`
2. Better Auth tables can remain (no conflict)
3. Original auth system continues working