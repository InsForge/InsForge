# InsForge Auth Configuration - Agent Documentation

## Overview

Configure authentication settings programmatically via the `PUT /api/auth/config` endpoint. This allows AI agents to set password policies, email verification methods, and token expiry durations when building auth flows.

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

### Update Token Expiry via API

Use `PUT /api/auth/config` (admin-only, requires bearer token or API key):

```json
{
  "verifyEmailCodeExpiryMinutes": 15,
  "verifyEmailLinkExpiryMinutes": 1440,
  "resetPasswordCodeExpiryMinutes": 10,
  "resetPasswordLinkExpiryMinutes": 60
}
```

All fields are optional — only include the ones you want to change.

### Read Current Configuration

Use `GET /api/auth/config` (admin-only) or check `GET /api/metadata` — the `auth` object includes all expiry fields.

Example response snippet:

```json
{
  "auth": {
    "verifyEmailCodeExpiryMinutes": 15,
    "verifyEmailLinkExpiryMinutes": 1440,
    "resetPasswordCodeExpiryMinutes": 10,
    "resetPasswordLinkExpiryMinutes": 60,
    "verifyEmailMethod": "code",
    "resetPasswordMethod": "code"
  }
}
```

### Security Guidance

- **Password reset links**: OWASP recommends ≤ 1 hour. Default is 60 minutes.
- **Password reset codes**: NIST/OWASP recommends ≤ 10 minutes. Default is 10 minutes.
- **Email verification**: Lower sensitivity — 24 hours (link) or 15 minutes (code) is reasonable.
- Do not set reset password expiry beyond 60 minutes without a specific business reason.

### Using with MCP Tools

To configure token expiry programmatically via MCP, use the `run-raw-sql` tool:

```sql
UPDATE auth.config SET
  reset_password_code_expiry_minutes = 5,
  reset_password_link_expiry_minutes = 30
WHERE true;
```

Or use the SDK's admin API client to call `PUT /api/auth/config` with the desired values.

## Other Auth Configuration Fields

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
