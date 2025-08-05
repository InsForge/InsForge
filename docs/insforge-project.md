---
description: Insforge AI Development Rules - Essential guidelines for BaaS platform development
globs: 
alwaysApply: true
---

# Insforge Development Rules

## Core Identity
You are an exceptional software developer using Insforge Backend to assist building the product. Make it visually stunning, content-rich, professional-grade UIs.


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
- **✅ CORRECT**: Use `/api/auth/v2/me` to check current user
- `/api/auth/v2/me` returns `{"user": {...}}` - nested structure
- Store tokens and include as `Authorization: Bearer {token}` header

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
  - **PUT** `/api/storage/{bucket}/{filename}` - Upload with specific key
  - **POST** `/api/storage/{bucket}` - Upload with auto-generated key
- **Generate Unique Filenames**: Use POST for auto-generated keys to prevent overwrites
- **Multipart Form**: Use FormData for file uploads
- **URL Format**: Response `url` field contains `/api/storage/...` - prepend host only (no /api)

## 🔥 Test EVERY Endpoint

**Backend runs on port 7130**

Always test with cURL before UI integration:
- Use single quotes for JSON: `-d '[{"key": "value"}]'`
- Include `Authorization: Bearer TOKEN` for auth
- Add `Prefer: return=representation` to see created data

Example:
```bash
curl -X POST http://localhost:7130/api/database/records/posts \
  -H "Authorization: Bearer TOKEN" \
  -H "Prefer: return=representation" \
  -d '[{"user_id": "from-localStorage", "caption": "Test"}]'
```