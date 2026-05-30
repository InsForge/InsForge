# Insforge OSS Authentication API Documentation

## Overview

Insforge uses JWT tokens and API keys for authentication. Store tokens in localStorage after login.
**All requests**: Use `Authorization: Bearer <token>` header (for both JWT tokens and API keys)

## Base URL
`http://localhost:7130`

## User Authentication

### Register New User
**POST** `/api/auth/users`

Body: `{"email": "user@example.com", "password": "password", "name": "User Name"}`

Returns: `{"accessToken": "...", "user": {"id": "...", "email": "...", "name": "...", "emailVerified": false, "createdAt": "...", "updatedAt": "..."}}`

**Note:** This creates an entry in the `users` table with the same `id` for profile data

### Login User  
**POST** `/api/auth/sessions`

Body: `{"email": "user@example.com", "password": "password"}`

Returns: `{"accessToken": "...", "user": {"id": "...", "email": "...", "name": "...", "emailVerified": false, "createdAt": "...", "updatedAt": "..."}}`

### Get Current User
**GET** `/api/auth/sessions/current` 

Headers: `Authorization: Bearer <accessToken>`

Returns: `{"user": {"id": "...", "email": "...", "role": "authenticated"}}`

**Note**: Returns LIMITED fields (id, email, role). For user profile data (nickname, avatar, bio, etc.), query `/api/database/records/users?id=eq.<user_id>`

**Common errors:**
- `401` with `"code": "MISSING_AUTHORIZATION_HEADER"` → No token provided
- `401` with `"code": "INVALID_TOKEN"` → Token expired or invalid

## Admin Authentication

### Admin Login
**POST** `/api/auth/admin/sessions`

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
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "admin-id",
    "email": "admin@example.com",
    "name": "Administrator",
    "role": "project_admin"
  }
}
```

```bash
# Mac/Linux
curl -X POST http://localhost:7130/api/auth/admin/sessions \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"change-this-password"}'

# Windows PowerShell (use curl.exe)
curl.exe -X POST http://localhost:7130/api/auth/admin/sessions \
  -H "Content-Type: application/json" \
  -d '{\"email\":\"admin@example.com\",\"password\":\"change-this-password\"}'
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
1. End user initiates OAuth login and receives authorization URL from backend
2. After successful user authorization, Google/GitHub redirects to backend callback
3. Backend generates JWT token and redirects to the application page

Prerequisites:
1. Create Google or GitHub OAuth Application and obtain Client ID and Client Secret
2. Configure each platform's Client ID/Client Secret in InsForge backend (via Environment Variables)

### OAuth Endpoints

#### Get OAuth URL (Google/GitHub)
**GET** `/api/auth/oauth/:provider`

Parameters:
- `provider`: "google" or "github" in the URL path
- Query params: `?redirect_uri=http://localhost:3000/dashboard`

Returns: `{"authUrl": "https://accounts.google.com/..."}` - URL to redirect user to provider's OAuth page.

```bash
# Mac/Linux
curl -X GET "http://localhost:7130/api/auth/oauth/google?redirect_uri=http://localhost:3000/dashboard"

# Windows PowerShell (use curl.exe)
curl.exe -X GET "http://localhost:7130/api/auth/oauth/google?redirect_uri=http://localhost:3000/dashboard"
```

Example response:
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=..."
}
```

#### OAuth Callback
The OAuth provider will redirect to:
- Google: `http://localhost:7130/api/auth/oauth/google/callback`
- GitHub: `http://localhost:7130/api/auth/oauth/github/callback`

After processing, backend redirects to your specified `redirect_uri` with JWT token in URL parameters:
- `access_token` - JWT authentication token
- `user_id` - User's unique ID  
- `email` - User's email address
- `name` - User's display name

## User Profile Table

### Users Table
The `users` table stores **user profile data**:
- **✅ READ** via: `GET /api/database/records/users`
- **✅ WRITE** via: `PATCH /api/database/records/users?id=eq.<user_id>`
- **✅ Foreign keys allowed** - reference `users.id`
- **IMPORTANT**: Add columns to this table for profile data instead of creating separate profile tables

**Schema:**
- `id` - User ID (UUID, primary key)
- `nickname` - Display name (text, nullable)
- `avatar_url` - Profile picture URL (text, nullable)
- `bio` - User biography (text, nullable)
- `birthday` - Birth date (date, nullable)
- `created_at` - Account creation timestamp
- `updated_at` - Last update timestamp

**Note:** Email and name from auth are returned by Auth API, not stored in users table

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
        "reference_table": "users",
        "reference_column": "id",
        "on_delete": "CASCADE",
        "on_update": "CASCADE"
      }
    }
  ]
}
```

### Available Tables
- **users** - User profile data (read/write access)
  - Use this table for foreign key references
  - Update profiles with PATCH requests

## Headers Summary

| API Type | Header Required |
|----------|----------------|
| Auth endpoints | None |
| Database/Storage | `Authorization: Bearer <accessToken>` |
| MCP testing only | `x-api-key: <key>` |

## Critical Notes

1. `/api/auth/sessions/current` returns `{"user": {...}}` - nested, not root level
2. `/api/auth/sessions/current` only has: id, email, role (limited fields)
3. Full user profile: `GET /api/database/records/users?id=eq.<id>`
4. POST to database requires `[{...}]` array format always
5. Auth endpoints (register/login): no headers needed
6. Protected endpoints: `Authorization: Bearer <accessToken>`