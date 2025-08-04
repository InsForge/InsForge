# Insforge OSS Instructions

## What Insforge OSS Does

Backend-as-a-service with database, authentication, and file storage. 

**Key Concept**: InsForge replaces your traditional backend - implement business logic by calling database operations directly. Instead of building API endpoints, use our database API as your application's backend.

## 🚨 Project Setup

**Create your app in a NEW directory, not inside `insforge/`**

The `insforge/` directory is the BaaS platform. Your app should live elsewhere:
```
~/projects/
├── insforge/      # ← BaaS platform (don't work here)
└── my-app/        # ← Your new app (work here)
```

## When to Use Tools

**MUST DO FIRST** → Download project rules: `download-project-rules`
**Start here** → `get-backend-metadata` (shows current database state)
**Need docs** → `get-db-api`, `get-auth-api`, or `get-storage-api`
**Create table** → `create-table` with explicit schema
**Work with data** → Use database API endpoints directly

## Critical Rule: 
**MUST DO FIRST** → Call`download-project-rules` to download project ruless

## Critical Rule: Check Metadata First

Before ANY database operation, call `get-backend-metadata` to get the current database state.

## Standard Workflow

1. **Always** call `get-backend-metadata` first
2. Check `get-instructions` if unfamiliar with the system
3. Create tables with `create-table` if needed
4. Use database API to insert/query/update/delete records
5. Call `get-backend-metadata` again to verify changes

## Key Rules

- Frequently check `get-instructions` and `get-backend-metadata`
- Always define explicit table schemas (no assumptions)
- Every table gets auto ID, created_at, updated_at fields
- **Database operations require BOTH**: API key (x-api-key header) AND JWT token (Authorization: Bearer header)
- File uploads work automatically with multipart/form-data

## Authentication Requirements

### Database Operations Need Two Headers:
1. **API Key**: `x-api-key: your-api-key` - Provides API access
2. **JWT Token**: `Authorization: Bearer your-jwt-token` - Authenticates the user

Without both headers, you'll get "permission denied" errors when trying to insert, update, or delete records.

### Getting Authentication:
```bash
# 1. First login to get JWT token
curl -X POST http://localhost:7130/api/auth/v2/admin/sign-in \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your-password"}'

# Response includes token: {"token": "eyJ...", "user": {...}}

# 2. Use both headers for database operations
curl -X POST http://localhost:7130/api/database/records/products \
  -H "x-api-key: your-api-key" \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '[{"name": "Product", "price": 99.99}]'
```

## System Tables

### User Table (Read-Only)
The `user` table is a **system-managed table** from Better Auth that contains user accounts:
- **CANNOT BE MODIFIED** through database API - use Auth API instead
- **CAN BE REFERENCED** by other tables (e.g., `user_id` foreign keys)
- Contains columns: id, email, name, emailVerified, createdAt, updatedAt
- To create/update users, use `/api/auth/v2/*` endpoints
- To query users, use `/api/database/records/user` (read-only)

## Example: Comment Upvoting Feature

- Check current tables: `get-backend-metadata`
- Create comment_votes table: `create-table` with user_id, comment_id, vote_type fields
- Frontend upvote action: `POST /api/database/records/comment_votes` with vote data
- Frontend display scores: `GET /api/database/records/comment_votes?comment_id=eq.123` to count votes
- No separate backend needed - frontend calls InsForge database API directly


## Critical Rule: Test API Endpoints with curl

After creating or modifying any API endpoint, always test it with curl to verify it works correctly:

```bash
# Example: Test creating a record (requires both API key and JWT token)
curl -X POST http://localhost:7130/api/database/records/posts \
  -H "x-api-key: your-api-key" \
  -H "Authorization: Bearer your-jwt-token" \
  -H "Content-Type: application/json" \
  -d '[{"title": "Test Post", "content": "Test content"}]'

# Example: Test querying records (requires both API key and JWT token)
curl http://localhost:7130/api/database/records/posts?id=eq.123 \
  -H "x-api-key: your-api-key" \
  -H "Authorization: Bearer your-jwt-token"

# Example: Test authentication
curl -X POST http://localhost:7130/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "testpass123"}'
```

Always include:
- **Both headers for database operations**: x-api-key AND Authorization: Bearer token
- Correct HTTP method (GET, POST, PATCH, DELETE)
- Valid JSON payload for POST/PATCH requests (remember: POST requires array format `[{...}]`)
- Query parameters for filtering GET requests
- Prefer: return=representation header if you want to see the created/updated records