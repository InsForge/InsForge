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


## 🚨 Project Setup

**Create your app in a NEW directory, not inside `insforge/`**

The `insforge/` directory is the BaaS platform. Your app should live elsewhere:
```
~/projects/
├── insforge/      # ← BaaS platform (don't work here)
└── my-app/        # ← Your new app (work here)
```

## 🚨 System Tables

### User Table (Read-Only)
The `user` table is a **system-managed table** from Better Auth:
- **CANNOT BE MODIFIED** through database API - use Auth API instead
- **CAN BE REFERENCED** by other tables with foreign keys (e.g., `user_id`)
- Contains: id, email, name, emailVerified, createdAt, updatedAt
- To create/update users: Use `/api/auth/v2/*` endpoints
- To query users: Use `/api/database/records/user` (read-only)

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
- After successful authentication, redirect to your application's main page
- Store session tokens (for users) or JWT tokens (for admins) and include as `Authorization: Bearer {token}` header for authenticated requests

### Regular API Response Format

**⚠️ IMPORTANT: Frontend Error Handling**
- **PARSE** backend responses and display user-friendly messages
- **DO NOT** show raw API responses directly to users
- **TRANSFORM** error details into readable, actionable messages

```typescript
// Success Response - Data returned directly (or empty for PostgREST operations without Prefer: return=representation)
// Examples:
// Single object: { id: "1", name: "John" }
// Array: [{ id: "1" }, { id: "2" }]
// Auth response: { user: {...}, token: "..." }

// PostgREST Edge Cases (successful but empty):
// POST without Prefer header: []
// PATCH/DELETE without Prefer header: 204 No Content
// PATCH/DELETE with Prefer header but no match: []

// Error Response
interface ErrorResponse {
  error: string;      // Error code (e.g., "NOT_FOUND")
  message: string;    // Human-readable message
  statusCode: number; // HTTP status code
  nextActions?: string; // Optional guidance
}

// Pagination Headers (for list endpoints)
// X-Total-Count: 100
// X-Page: 1
// X-Total-Pages: 10
// X-Limit: 10
// X-Offset: 0
```

### 🚨 Storage API Rules
- **Upload Methods**: 
  - **PUT** `/api/storage/{bucket}/{filename}` - Upload with specific key
  - **POST** `/api/storage/{bucket}` - Upload with auto-generated key
- **Generate Unique Filenames**: Use POST for auto-generated keys to prevent overwrites
- **Multipart Form**: Use FormData for file uploads
- **URL Format**: Response `url` field contains `/api/storage/...` - prepend host only (no /api)

## 🔥 MANDATORY: Test Every Endpoint with cURL

### **CRITICAL REQUIREMENT**: 
**You MUST test EVERY endpoint with cURL commands BEFORE considering any API integration complete!**

- **Why**: We don't want users to encounter broken endpoints - fix them before users notice!
- **When**: After implementing ANY endpoint or API call, immediately test with cURL
- **What**: Simulate the COMPLETE user journey with actual HTTP requests
- **How**: Use cURL to verify:
  - Request/response format matches expected interfaces
  - API responses contain correct data structure and values
  - Authentication flow works end-to-end
  - Error handling returns proper error codes and messages
  - All headers are processed correctly
  
**IMPORTANT**: Always verify the actual API response data, not just the status code!

### Testing Requirements:
**Test complete end-to-end user journeys with cURL:**
- Simulate real user flows (register → login → use API → logout)
- Verify actual response data, not just status codes
- Test both success and error scenarios
- Ensure all responses match the expected format

**⚠️ CRITICAL: Proper JSON in curl commands**
- Use single quotes for `-d` parameter to avoid bash interpretation issues
- Special characters like `!` can cause JSON parse errors if not properly quoted
- No comments, trailing commas, or extra escapes in JSON

```bash
# ✅ GOOD: Single quotes prevent bash issues
curl -X POST http://localhost:PORT/api/database/records/comments \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '[{"content": "Great post!"}]'

# ❌ BAD: Double quotes can cause issues with special characters
curl -X POST http://localhost:PORT/api/database/records/comments \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d "[{\"content\": \"Great post!\"}]"  # Bash may escape the !

# Example: Complete user journey
curl -X POST http://localhost:PORT/api/auth/v2/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"pass123","name":"Test User"}' | jq .

# Extract token from response and test authenticated endpoints
TOKEN="<token-from-response>"
curl http://localhost:PORT/api/auth/v2/me \
  -H "Authorization: Bearer $TOKEN" | jq .
```