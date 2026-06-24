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
- **Register**: `POST /api/auth/users` - Create new user account
- **Login**: `POST /api/auth/sessions` - Authenticate existing user
- **Admin Login**: `POST /api/auth/admin/sessions` - Admin authentication
- **Current User**: `GET /api/auth/sessions/current` - Get authenticated user info
- `/api/auth/sessions/current` returns `{"user": {...}}` - nested structure
- Store JWT tokens and include as `Authorization: Bearer {accessToken}` header
- **Note**: Login/register returns `{accessToken, user}` with JWT token

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
- **Authentication**: Upload operations require `Authorization: Bearer {accessToken}`
- **Generate Unique Filenames**: Use POST for auto-generated keys to prevent overwrites
- **Multipart Form**: Use FormData for file uploads
- **URL Format**: Storage returns **ABSOLUTE URLs** (e.g., `http://localhost:7130/api/storage/buckets/{bucket}/objects/{filename}`)
  - **IMPORTANT**: URLs are complete and ready to use - no need to prepend host or path
  - Use the URL directly in `<img src>` or fetch requests

## 🔥 Test EVERY Endpoint

**Backend runs on port 7130**

Always test with cURL before UI integration:
- Include `Authorization: Bearer {accessToken}` for auth
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