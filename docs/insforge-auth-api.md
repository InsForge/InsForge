# Insforge OSS Authentication API Documentation

## Overview

Insforge uses JWT tokens for authentication. Store tokens in localStorage after login.
**MCP Testing**: Use `x-api-key` header
**Production**: Use `Authorization: Bearer <token>` header

## Base URL
`http://localhost:7130`

## User Authentication

### Register New User
**POST** `/api/auth/v2/sign-up/email`

Body: `{"email": "user@example.com", "password": "password", "name": "User Name"}`

Returns: `{"token": "...", "user": {"id": "...", "email": "...", "name": "...", "emailVerified": false, "createdAt": "...", "updatedAt": "..."}}`

### Login User  
**POST** `/api/auth/v2/sign-in/email`

Body: `{"email": "user@example.com", "password": "password"}`

Returns: `{"token": "...", "user": {"id": "...", "email": "...", "name": "...", "emailVerified": false, "createdAt": "...", "updatedAt": "..."}}`

### Get Current User
**GET** `/api/auth/v2/me` 

Headers: `Authorization: Bearer <token>`

Returns: `{"user": {"id": "...", "email": "...", "type": "user", "role": "authenticated"}}`

**Note**: Returns LIMITED fields (id, email, type, role). For full user data including name/image, query `/api/database/records/user?id=eq.<user_id>`

**Common errors:**
- `401` with `"code": "MISSING_AUTHORIZATION_HEADER"` → No token provided
- `401` with `"code": "INVALID_TOKEN"` → Token expired or invalid

## Admin Authentication

### Admin Login
**POST** `/api/auth/v2/admin/sign-in`

Request:
```json
{
  "email": "admin@example.com",
  "password": "change-this-password"
}
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "admin-id",
    "email": "admin@example.com",
    "name": "Administrator",
    "role": "project_admin"
  }
}
```

Example curl:
```bash
curl -X POST http://localhost:7130/api/auth/v2/admin/sign-in \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"change-this-password"}'
```

## Error Response Format

All error responses follow this format:
```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable error message"
}
```

Example error:
```json
{
  "code": "INVALID_EMAIL",
  "message": "Please provide a valid email"
}
```

## OAuth Support

Insforge supports Google and GitHub OAuth when configured with environment variables.

OAuth workflow:
1. End user clicks the OAuth login button and gets redirect URL from InsForge backend
2. After successful user authorization, Google/GitHub redirects to InsForge backend
3. InsForge backend generates session token and redirects to the application page

Prerequisites:
1. Create Google or GitHub OAuth Application and obtain Client ID and Client Secret
2. Configure each platform's Client ID/Client Secret in InsForge backend (via Environment Variables)

### OAuth Endpoints

#### Social Login (Google/GitHub)
**POST** `/api/auth/v2/sign-in/social`

Request:
```json
{
  "provider": "google",
  "callbackURL": "http://localhost:7131/dashboard",
  "errorCallbackURL": "http://localhost:7131/login?error=oauth",
  "disableRedirect": true
}
```

Parameters:
- `provider`: "google" or "github" (required)
- `callbackURL`: Where to redirect after successful login (required)
- `errorCallbackURL`: Where to redirect on error (optional)
- `disableRedirect`: Return URL instead of auto-redirecting (optional)

Response (when disableRedirect: true):
```json
{
  "url": "https://accounts.google.com/o/oauth2/auth?client_id=...",
  "redirect": false
}
```

Example curl:
```bash
curl -X POST http://localhost:7130/api/auth/v2/sign-in/social \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "callbackURL": "http://localhost:7131/dashboard",
    "disableRedirect": true
  }'
```

#### OAuth Callback
The OAuth provider will redirect to:
- Google: `http://localhost:7130/api/auth/v2/callback/google`
- GitHub: `http://localhost:7130/api/auth/v2/callback/github`

After processing, Better Auth redirects to your specified `callbackURL` with the user session.

## Built-in Auth Tables

### User Table (Read-Only)
The `user` table is **system-managed**:
- **✅ READ** via: `GET /api/database/records/user`
- **❌ NO WRITE** - use Auth API instead
- **✅ Foreign keys allowed**
- Schema: `id`, `email`, `name`, `image`, `emailVerified`, `createdAt`, `updatedAt`

Example - Create table with user reference:
```json
{
  "table_name": "posts",
  "columns": [
    {
      "name": "title",
      "type": "string",
      "nullable": false,
      "is_unique": false
    },
    {
      "name": "user_id",
      "type": "string",
      "nullable": false,
      "is_unique": false,
      "foreign_key": {
        "reference_table": "user",
        "reference_column": "id",
        "on_delete": "CASCADE",
        "on_update": "CASCADE"
      }
    }
  ]
}
```

### Hidden System Tables
These tables are managed by Better Auth and not visible in metadata:
- **session** - Active user sessions
- **account** - OAuth provider connections
- **verification** - Email verification tokens
- **jwks** - JSON Web Key Sets

## Headers Summary

| API Type | Header Required |
|----------|----------------|
| Auth endpoints | None |
| Database/Storage | `Authorization: Bearer <token>` |
| MCP testing only | `x-api-key: <key>` |

## Critical Notes

1. `/api/auth/v2/me` returns `{"user": {...}}` - nested, not root level
2. `/api/auth/v2/me` only has: id, email, type, role (no name/image)
3. Full user data: `GET /api/database/records/user?id=eq.<id>`
4. POST requires `[{...}]` array format always
5. Auth endpoints: no headers needed
6. Database/Storage: `Authorization: Bearer <token>`