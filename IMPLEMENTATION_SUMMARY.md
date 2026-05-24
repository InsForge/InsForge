# OAuth extra_authorize_params Implementation

## ✅ Completed Changes

### 1. Schema Updates
- **File**: `packages/shared-schemas/src/auth.schema.ts`
- **Change**: Added `extraAuthorizeParams: z.record(z.string()).optional()` to `oAuthConfigSchema`

### 2. Database Migration  
- **File**: `backend/src/infra/database/migrations/047_add-extra-authorize-params-to-oauth.sql`
- **Change**: Added `extra_authorize_params JSONB` column to `auth.oauth_configs` table

### 3. Google OAuth Provider
- **File**: `backend/src/providers/oauth/google.provider.ts` (lines 77-82)
- **Change**: Added code to merge `config.extraAuthorizeParams` into the authorization URL

### 4. OAuth Config Service (SELECT queries)
- **File**: `backend/src/services/auth/oauth-config.service.ts`
- **Change**: Added `extra_authorize_params as "extraAuthorizeParams"` to all SELECT queries (4 locations)

## ⚠️ Still Needs Completion

### 5. OAuth Config Service (INSERT/UPDATE)
Need to update INSERT and UPDATE queries to include `extra_authorize_params`:
- Line ~242: INSERT statement - add column and parameter
- Find UPDATE statements and add the field

### 6. Other OAuth Providers
Apply the same extra params merging to:
- `backend/src/providers/oauth/github.provider.ts`
- `backend/src/providers/oauth/linkedin.provider.ts`
- `backend/src/providers/oauth/discord.provider.ts`
- `backend/src/providers/oauth/facebook.provider.ts`
- `backend/src/providers/oauth/microsoft.provider.ts`
- `backend/src/providers/oauth/x.provider.ts`
- `backend/src/providers/oauth/apple.provider.ts`

### 7. SDK Updates (Separate Repository)
Repository: `InsForge/InsForge-sdk-js`
- Update `signInWithOAuth()` to accept `extraParams` option
- Pass extra params to the backend OAuth initialization URL
- Update TypeScript types

### 8. OpenAPI Documentation
- Update `openapi/auth.yaml` to include `extraAuthorizeParams` field

### 9. Testing
- Test with Google OAuth + `prompt=select_account`
- Test with other providers
- Verify database migration works
- Test API endpoints

## 📝 How to Use (Once Complete)

### Backend Configuration (Dashboard/API):
```json
{
  "provider": "google",
  "clientId": "...",
  "clientSecret": "...",
  "extraAuthorizeParams": {
    "prompt": "select_account"
  }
}
```

### SDK Usage (Future):
```typescript
await insforge.auth.signInWithOAuth({
  provider: 'google',
  redirectTo: 'https://myapp.com/callback',
  extraParams: {
    prompt: 'select_account'
  }
})
```

## 🚀 Next Steps
1. Complete remaining backend changes (INSERT/UPDATE + other providers)
2. Fork and update SDK repository
3. Test locally
4. Submit PR to InsForge/InsForge
5. Submit PR to InsForge/InsForge-sdk-js
