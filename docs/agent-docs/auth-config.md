# InsForge Auth Configuration - Agent Documentation

## Overview

Configure authentication settings programmatically via **`PUT /api/auth/config`** (admin-only). This allows AI agents to set password policies, email verification methods, and token expiry durations when building auth flows.

## Token Expiry Configuration

Token expiry settings control how long OTP codes and verification/reset links remain valid. Each purpose (email verification, password reset) has independent settings for both delivery methods (code, link).

### Available Fields

| Field | Type | Range | Default | Description |
|-------|------|-------|---------|-------------|
| `verifyEmailCodeExpiryMinutes` | integer | 1–10080 | 15 | Expiry for 6-digit email verification codes |
| `verifyEmailLinkExpiryMinutes` | integer | 1–10080 | 1440 | Expiry for email verification links (1440 = 24h) |
| `resetPasswordCodeExpiryMinutes` | integer | 1–10080 | 10 | Expiry for 6-digit password reset codes |
| `resetPasswordLinkExpiryMinutes` | integer | 1–10080 | 60 | Expiry for password reset links (60 = 1h) |

Range: 1 minute to 10080 minutes (7 days).

### Update token expiry (canonical)

Use **`PUT /api/auth/config`** with a JSON body (camelCase keys). Admin auth: `Authorization: Bearer <ik_…>` API key or `project_admin` JWT.

```http
PUT /api/auth/config
Content-Type: application/json
```

```json
{
  "resetPasswordCodeExpiryMinutes": 10,
  "resetPasswordLinkExpiryMinutes": 60
}
```

All fields are optional — only include fields you want to change. The API validates with the shared Zod schema (range 1–10080) and clears the in-process auth config cache so OTP flows see updates immediately.

### Read current configuration

**Canonical for the stored config row:** **`GET /api/auth/config`** (admin-only). Response is the `auth.config` database row in camelCase, including `id`, `createdAt`, `updatedAt`, and all policy/expiry columns. It does **not** include aggregated OAuth provider lists (those appear only on the metadata routes below).

**Metadata routes** (same admin auth) expose the same **auth metadata** shape in two ways:

| Endpoint | Response shape |
|----------|----------------|
| **`GET /api/metadata/auth`** | **Canonical for “auth only” in metadata:** the JSON body **is** the auth metadata object directly (no outer `auth` key). |
| **`GET /api/metadata`** | Full app metadata: `{ "auth": { … }, "database": { … }, "storage": { … }, … }`. The `auth` property matches **`GET /api/metadata/auth`**. |

Example — body of **`GET /api/metadata/auth`** (and the `auth` value inside **`GET /api/metadata`**):

```json
{
  "oAuthProviders": [],
  "customOAuthProviders": [],
  "requireEmailVerification": false,
  "passwordMinLength": 6,
  "requireNumber": false,
  "requireLowercase": false,
  "requireUppercase": false,
  "requireSpecialChar": false,
  "verifyEmailMethod": "code",
  "resetPasswordMethod": "code",
  "allowedRedirectUrls": [],
  "verifyEmailCodeExpiryMinutes": 15,
  "verifyEmailLinkExpiryMinutes": 1440,
  "resetPasswordCodeExpiryMinutes": 10,
  "resetPasswordLinkExpiryMinutes": 60
}
```

### Security guidance

- **Password reset links**: OWASP recommends ≤ 1 hour. Default is 60 minutes.
- **Password reset codes**: NIST/OWASP recommends ≤ 10 minutes. Default is 10 minutes.
- **Email verification**: Lower sensitivity — 24 hours (link) or 15 minutes (code) is reasonable.
- Do not set reset password expiry beyond 60 minutes without a specific business reason.

### Programmatic / MCP usage

**Prefer `PUT /api/auth/config`** (HTTP or your SDK’s admin client that wraps it). Do **not** use `run-raw-sql` (or other direct SQL) to update `auth.config`: that skips Zod validation (invalid values can be written), bypasses the service layer, and can leave **`AuthConfigService`’s in-memory cache stale** for up to its TTL (~30s), so the running API may keep issuing OTPs with old expiries until the cache expires or the process restarts.

## Other auth configuration fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `requireEmailVerification` | boolean | false | Require email verification before login |
| `passwordMinLength` | integer (4–128) | 6 | Minimum password length |
| `requireNumber` | boolean | false | Require at least one number |
| `requireLowercase` | boolean | false | Require at least one lowercase letter |
| `requireUppercase` | boolean | false | Require at least one uppercase letter |
| `requireSpecialChar` | boolean | false | Require at least one special character |
| `verifyEmailMethod` | "code" \| "link" | "code" | Email verification delivery method |
| `resetPasswordMethod` | "code" \| "link" | "code" | Password reset delivery method |
| `allowedRedirectUrls` | string[] | [] | Allowed redirect URLs for auth flows |
