---
description: Insforge AI Development Rules - Essential guidelines for BaaS platform development
globs: 
alwaysApply: true
---

# Insforge Development Rules

## Core Identity
You are an exceptional software developer using Insforge Backend to assist building the product. Make it visually stunning, content-rich, professional-grade UIs.

## 🔴 MANDATORY: cURL Test at EVERY Step

**For AI Agents: Test with cURL repeatedly throughout development:**

1. **Before coding** → Test endpoint exists, check response format
2. **During coding** → Test when confused about any API behavior  
3. **After coding** → Test complete user journey end-to-end
4. **When debugging** → Test to see actual vs expected responses

```bash
# Mac/Linux
curl -X POST http://localhost:7130/api/[endpoint] \
  -H 'Content-Type: application/json' \
  -d '[{"key": "value"}]' | jq .

# Windows PowerShell (use curl.exe) - different quotes for nested JSON
curl.exe -X POST http://localhost:7130/api/[endpoint] \
  -H "Content-Type: application/json" \
  -d '[{\"key\": \"value\"}]' | jq .
```

**You WILL get it wrong without testing. Test early, test often.**

## Critical Architecture Points

When in doubt, read instructions documents again.

## 🚨 System Tables

### User Table (Read-Only)
The `user` table is **protected** by Better Auth:
- **✅ CAN READ** via `GET /api/database/records/user`
- **❌ CANNOT MODIFY** (POST/PUT/PATCH/DELETE) - use Auth API instead
- **✅ CAN reference** with foreign keys
- Get `user_id` from `localStorage.getItem('user_id')` after login

## 🚨 CRUD Operations - PostgREST NOT RESTful
### PostgREST Database API Behavior

**Critical PostgREST Rules:**

1. **POST requires array**: `[{...}]` even for single record
2. **Empty responses without `Prefer: return=representation`**:
   - POST → `[]` (empty array)
   - PATCH → 204 No Content
   - DELETE → 204 No Content
   - **DELETE is idempotent** - no error if record doesn't exist
3. **With `Prefer: return=representation`**: 
   - Returns affected records as array
   - DELETE and PATCH returns `[]` if record didn't exist
4. **Pagination**: 
   - Request: `Range: 0-9` + `Prefer: count=exact`
   - Response: `Content-Range: 0-9/100` header (shows total)
   - Without `Prefer: count=exact`: `Content-Range: 0-9/*` (no total)
5. **Query syntax**: `?field=operator.value`
   - `?id=eq.123` (equals)
   - `?age=gt.30` (greater than)
   - `?name=like.*john*` (pattern match)

## Auth Operations:

### 🚨 IMPORTANT: Correct Auth Endpoints
- **Register**: `POST /api/auth/v2/sign-up/email` - Create new user account
- **Login**: `POST /api/auth/v2/sign-in/email` - Authenticate existing user
- **Current User**: `GET /api/auth/v2/me` - Get authenticated user info
- **Get Session** (OAuth): `GET /api/auth/v2/get-session` - Get session from cookie (use `credentials: 'include'`)
- `/api/auth/v2/me` returns `{"user": {...}}` - nested structure
- Store tokens and include as `Authorization: Bearer {session-token}` header
- **Note**: Login returns a session token (not JWT) - backend converts it automatically

### OAuth Implementation Note
After OAuth redirect, call `/api/auth/v2/get-session` with `credentials: 'include'` to retrieve session from cookie. Better Auth doesn't pass tokens in URL params.

### Regular API Response Format

**⚠️ IMPORTANT: Frontend Error Handling**
- **PARSE** backend responses and display user-friendly messages
- **DO NOT** show raw API responses directly to users
- **TRANSFORM** error details into readable, actionable messages

- Success: Data directly (object/array)
- Error: `{error, message, statusCode}`
- Empty POST/PATCH/DELETE: Add `Prefer: return=representation`

### 🚨 Storage API Rules
- **Upload Methods**: 
  - **PUT** `/api/storage/buckets/{bucket}/objects/{filename}` - Upload with specific key
  - **POST** `/api/storage/buckets/{bucket}/objects` - Upload with auto-generated key
- **Authentication**: Upload operations require `Authorization: Bearer {session-token}`
- **Generate Unique Filenames**: Use POST for auto-generated keys to prevent overwrites
- **Multipart Form**: Use FormData for file uploads
- **URL Format**: Response `url` field now contains correct format `/api/storage/buckets/{bucket}/objects/{filename}`

## 🔥 Test EVERY Endpoint

**Backend runs on port 7130**

Always test with cURL before UI integration:
- Include `Authorization: Bearer TOKEN` for auth
- Add `Prefer: return=representation` to see created data
- Windows PowerShell: use curl.exe

```bash
# Mac/Linux
curl -X POST http://localhost:7130/api/database/records/posts \
  -H 'Authorization: Bearer TOKEN' \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d '[{"user_id": "from-localStorage", "caption": "Test"}]'

# Windows PowerShell (use curl.exe) - different quotes for nested JSON
curl.exe -X POST http://localhost:7130/api/database/records/posts \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '[{\"user_id\": \"from-localStorage\", \"caption\": \"Test\"}]'
```