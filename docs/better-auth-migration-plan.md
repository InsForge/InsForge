# InsForge to Better Auth Migration Plan

## Overview
This document outlines the migration strategy from InsForge's custom auth system to Better Auth.

## Phase 1: Preparation (Week 1)

### 1.1 Environment Setup
- [ ] Create a new branch `feature/better-auth-migration`
- [ ] Install Better Auth dependencies
- [ ] Set up Better Auth configuration file
- [ ] Create test database for migration testing

### 1.2 Schema Analysis
- [ ] Map InsForge tables to Better Auth schema:
  - `_auth` → Better Auth `user` table
  - `_profiles` → Better Auth `user` extended fields
  - `_identifies` → Better Auth `account` table (OAuth connections)
  - `_superuser_auth` → Better Auth with admin plugin
  - `_superuser_profiles` → Admin user extended fields

### 1.3 Feature Mapping
- [ ] Email/Password auth → Better Auth core
- [ ] Google OAuth → Better Auth Google provider
- [ ] GitHub OAuth → Better Auth GitHub provider
- [ ] JWT tokens → Better Auth JWT plugin
- [ ] API Keys → Better Auth API Keys plugin
- [ ] Admin system → Better Auth admin plugin + custom roles

## Phase 2: Implementation (Week 2-3)

### 2.1 Better Auth Setup
```typescript
// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins/jwt";
import { admin } from "better-auth/plugins/admin";
import { apiKeys } from "better-auth/plugins/api-keys";
import { googleProvider } from "better-auth/providers/google";
import { githubProvider } from "better-auth/providers/github";

export const auth = betterAuth({
  database: {
    type: "sqlite",
    url: process.env.DATABASE_URL,
  },
  plugins: [
    jwt({
      expiresIn: 60 * 60 * 24 * 7, // 7 days
    }),
    admin(),
    apiKeys(),
  ],
  socialProviders: {
    google: googleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    github: githubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  },
});
```

### 2.2 Database Migration Script
```typescript
// scripts/migrate-auth-data.ts
async function migrateUsers() {
  // 1. Migrate regular users
  const users = await db.query("SELECT * FROM _auth");
  const profiles = await db.query("SELECT * FROM _profiles");
  
  for (const user of users) {
    const profile = profiles.find(p => p.user_id === user.id);
    await betterAuth.createUser({
      email: user.email,
      password: user.password_hash, // Already hashed
      name: profile?.name,
      image: profile?.avatar_url,
      emailVerified: true, // Assuming all existing users are verified
    });
  }
  
  // 2. Migrate OAuth connections
  const identifies = await db.query("SELECT * FROM _identifies");
  for (const identity of identifies) {
    await betterAuth.linkAccount({
      userId: identity.user_id,
      provider: identity.provider,
      providerAccountId: identity.provider_id,
    });
  }
  
  // 3. Migrate admin users
  const adminUsers = await db.query("SELECT * FROM _superuser_auth");
  // ... similar migration logic with admin role
}
```

### 2.3 API Endpoint Migration
Replace current endpoints with Better Auth endpoints:

| Current Endpoint | Better Auth Endpoint | Action Required |
|------------------|---------------------|-----------------|
| POST /api/auth/register | POST /api/auth/signup | Update client |
| POST /api/auth/login | POST /api/auth/signin | Update client |
| GET /api/auth/me | GET /api/auth/user | Update client |
| PUT /api/auth/profile | PATCH /api/auth/update-user | Update client |
| POST /api/auth/oauth/google | GET /api/auth/google | OAuth flow change |
| POST /api/auth/oauth/github | GET /api/auth/github | OAuth flow change |

### 2.4 Middleware Updates
```typescript
// Before: Custom JWT verification
const verifyToken = async (token: string) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  // ...
};

// After: Better Auth session
const session = await auth.api.getSession({
  headers: request.headers,
});
```

## Phase 3: Testing (Week 4)

### 3.1 Unit Tests
- [ ] Test user registration flow
- [ ] Test login flow
- [ ] Test OAuth flows (Google, GitHub)
- [ ] Test JWT token generation/validation
- [ ] Test API key authentication
- [ ] Test admin authentication

### 3.2 Integration Tests
- [ ] Test database operations
- [ ] Test session management
- [ ] Test role-based access control
- [ ] Test activity logging integration

### 3.3 E2E Tests with cURL
```bash
# Test registration
curl -X POST http://localhost:7130/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","name":"Test User"}'

# Test login
curl -X POST http://localhost:7130/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Test session
curl http://localhost:7130/api/auth/user \
  -H "Cookie: better-auth.session=..."
```

## Phase 4: Migration (Week 5)

### 4.1 Data Migration
1. **Backup current database**
2. **Run migration script** in test environment
3. **Verify data integrity**
4. **Run migration in staging**
5. **Final production migration**

### 4.2 Gradual Rollout
```typescript
// Feature flag approach
const USE_BETTER_AUTH = process.env.FEATURE_BETTER_AUTH === 'true';

if (USE_BETTER_AUTH) {
  app.use('/api/auth', betterAuthRouter);
} else {
  app.use('/api/auth', legacyAuthRouter);
}
```

### 4.3 Monitoring
- [ ] Set up error tracking for auth failures
- [ ] Monitor login success rates
- [ ] Track OAuth connection issues
- [ ] Watch for migration-related errors

## Phase 5: Cleanup (Week 6)

### 5.1 Remove Legacy Code
- [ ] Remove old auth controllers
- [ ] Remove old auth services
- [ ] Remove old auth middleware
- [ ] Remove old auth types

### 5.2 Update Documentation
- [ ] Update API documentation
- [ ] Update client SDK examples
- [ ] Update deployment guides
- [ ] Update environment variable docs

### 5.3 Client Updates
- [ ] Update frontend auth logic
- [ ] Update mobile app auth
- [ ] Update CLI tools
- [ ] Update any third-party integrations

## Rollback Strategy

If issues arise during migration:

1. **Database**: Keep backup of original auth tables
2. **Code**: Use feature flags to switch back
3. **API**: Maintain backward compatibility during transition
4. **Timeline**: Allow 2-week dual-system period

## Success Criteria

- [ ] All existing users can log in
- [ ] OAuth connections preserved
- [ ] API keys continue working
- [ ] Admin access maintained
- [ ] No data loss
- [ ] Performance equal or better
- [ ] Zero downtime during migration

## Risk Mitigation

1. **Data Loss**: Multiple backups, test migrations
2. **Auth Failures**: Gradual rollout, monitoring
3. **OAuth Issues**: Test with real providers
4. **Performance**: Load testing before switch
5. **Security**: Security audit post-migration

## Timeline Summary

- **Week 1**: Preparation and setup
- **Week 2-3**: Implementation
- **Week 4**: Testing
- **Week 5**: Migration and rollout
- **Week 6**: Cleanup and documentation

Total estimated time: 6 weeks with buffer for issues