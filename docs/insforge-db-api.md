# Insforge OSS Database API Documentation

## API Basics

**Base URL:** `http://localhost:7130`
**Authentication:** All requests require authentication token (`Authorization: Bearer <token>` header)
**Note:** The `x-api-key` header is only used for MCP testing and should not be used in production applications
**Critical:** Always call `get-backend-metadata` first to understand current database structure
**Critical:** POST body must be arrays `[{...}]`, query filters `?field=eq.value`, add header `Prefer: return=representation` to return created data - follows PostgREST design (not traditional REST)

## Table Operations (Use MCP Tools)

### Available MCP Tools

1. **get-backend-metadata** - Get current database structure (always start here)
2. **create-table** - Create new table with explicit schema
3. **update-table-schema** - Alter existing table schema  
4. **delete-table** - Remove table completely
5. **get-table-schema** - Get specific table structure

### Column Types
- `string` - Text data
- `integer` - Whole numbers
- `float` - Decimal numbers
- `boolean` - True/false values
- `datetime` - Date and timep
- `json` - JSON objects
- `uuid` - Unique identifiers

## Record Operations (Use REST API)

### Base URL
`/api/database/records/:tableName`

### Query Records
**GET** `/api/database/records/:tableName`

Query parameters:
- `limit` - Maximum records (default: 100)
- `offset` - Skip records for pagination
- `order` - Sort by field (e.g., `createdAt.desc`)
- PostgREST filters: `field=eq.value`, `field=gt.value`, etc.

Response: Array of records with auto-generated `id`, `created_at`, `updated_at` fields

Example:
```bash
curl -X GET "http://localhost:7130/api/database/records/users?limit=10" \
  -H "Authorization: Bearer TOKEN"
```

### Create Records
**POST** `/api/database/records/:tableName`

**CRITICAL**: Request body MUST be an array, even for single records!

**⚠️ IMPORTANT: Default Response Behavior**
- **By default, POST requests return an empty array `[]`**
- **To get the created records in the response, you MUST include the header:**
  ```
  Prefer: return=representation
  ```
- **Without this header, you get no data back, just an empty array!**

Send array of records:
```json
[
  {
    "field1": "value1",
    "field2": "value2"
  }
]
```

For a single record, still wrap in array:
```json
[
  {
    "name": "John Doe",
    "email": "john@example.com"
  }
]
```

Response format (WITHOUT `Prefer` header - default):
```json
[]
```

Response format (WITH `Prefer: return=representation` header):
```json
[
  {
    "id": "248373e1-0aea-45ce-8844-5ef259203749",
    "name": "John Doe",
    "email": "john@example.com",
    "createdAt": "2025-07-18T05:37:24.338Z",
    "updatedAt": "2025-07-18T05:37:24.338Z"
  }
]
```

Example:
```bash
curl -X POST http://localhost:7130/api/database/records/users \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '[{"name": "John Doe", "email": "john@example.com"}]'
```

### Update Record
**PATCH** `/api/database/records/:tableName?id=eq.uuid`

**⚠️ IMPORTANT: Default Response Behavior**
- **By default, PATCH requests return an empty array `[]`**
- **To get the updated record in the response, you MUST include the header:**
  ```
  Prefer: return=representation
  ```

Send fields to update:
```json
{
  "field1": "new_value"
}
```

Response format (WITHOUT `Prefer: return=representation` header - default):
```json
""
```

Response format (WITH `Prefer: return=representation` header):
```json
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "field1": "new_value",
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-21T11:00:00Z"
  }
]
```

Example:
```bash
curl -X PATCH "http://localhost:7130/api/database/records/users?id=eq.UUID" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"name": "Jane Doe"}'
```

### Delete Record
**DELETE** `/api/database/records/:tableName?id=eq.uuid`

**⚠️ IMPORTANT: Delete Behavior**
- **Without `Prefer: return=representation`**: Returns `204 No Content` (no body)
- **With `Prefer: return=representation`**: Returns `200 OK` with:
  - `[{...}]` - Array containing deleted record(s) if found
  - `[]` - Empty array if record didn't exist
- **DELETE is idempotent**: No error if record doesn't exist

Response format (WITHOUT `Prefer` header - default):
```
204 No Content (no body)
```

Response format (WITH `Prefer: return=representation` header):
```json
// If record existed and was deleted:
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "Deleted User",
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-21T11:00:00Z"
  }
]

// If record didn't exist (already deleted or never existed):
[]
```

Example:
```bash
curl -X DELETE "http://localhost:7130/api/database/records/users?id=eq.UUID" \
  -H "Authorization: Bearer TOKEN" \
  -H "Prefer: return=representation"
```


## Error Response Format

All error responses follow this format:
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error message",
  "statusCode": 400,
  "nextActions": "Suggested action to resolve the error"
}
```

Example error:
```json
{
  "error": "TABLE_NOT_FOUND",
  "message": "Table 'nonexistent' does not exist",
  "statusCode": 404,
  "nextActions": "Check table name and try again"
}
```

## 🚨 Critical: User Table is Read-Only

**The `user` table has limited access:**
- **✅ READ**: `GET /api/database/records/user` - Works!
- **❌ WRITE**: POST/PUT/PATCH/DELETE returns `403 FORBIDDEN`
- **Solution**: For additional user data, create `user_profiles` table:
```json
{
  "table_name": "user_profiles",
  "columns": [
    {"name": "user_id", "type": "string", "nullable": false, "is_unique": true,
     "foreign_key": {"reference_table": "user", "reference_column": "id", 
                     "on_delete": "CASCADE", "on_update": "CASCADE"}},
    {"name": "bio", "type": "string", "nullable": true},
    {"name": "avatar_url", "type": "string", "nullable": true}
  ]
}
```

## 🚨 Critical: Always Include user_id

**Every user-related table MUST include user_id field from localStorage:**

```javascript
// Frontend: Get user_id from localStorage after login
const userId = localStorage.getItem('user_id');
```

```bash
# ❌ WRONG - Missing user_id
curl -X POST http://localhost:7130/api/database/records/comments \
  -H "Authorization: Bearer TOKEN" \
  -d '[{"content": "Great post"}]'

# ✅ CORRECT - Includes user_id
curl -X POST http://localhost:7130/api/database/records/comments \
  -H "Authorization: Bearer TOKEN" \
  -H "Prefer: return=representation" \
  -d '[{"content": "Great post!", "user_id": "user-uuid-from-localStorage"}]'
```

**Required for all user-related operations:**
- Creating posts, comments, likes, follows
- Any table with a `user_id` foreign key
- Without it, your INSERT will fail with missing field error

## Important Rules

1. **Auto-Generated Fields**
   - `id` - UUID primary key (auto-generated)
   - `createdAt` - Timestamp (auto-set)
   - `updatedAt` - Timestamp (auto-updated)

2. **System Tables**
   - Tables prefixed with `_` are system tables
   - Better Auth tables (`user`, `session`, `account`) - use Auth API only
   - **`user` table is PROTECTED** - cannot query via database API

3. **Remember**
   - Schema changes use MCP tools
   - Record operations use REST API
   - All operations need authentication token (Bearer token)
   - API keys (`x-api-key`) are only for MCP testing, not for production use
   - Always include `user_id` in user-related tables