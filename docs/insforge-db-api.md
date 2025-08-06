# Insforge OSS Database API Documentation

## API Basics

**Base URL:** `http://localhost:7130`
**Authentication:** All requests require `x-api-key` header
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

Response format:
```json
[
  {
    "id": "248373e1-0aea-45ce-8844-5ef259203749",
    "name": "John Doe",
    "createdAt": "2025-07-18T05:37:24.338Z",
    "updatedAt": "2025-07-18T05:37:24.338Z"
  }
]
```

Example curl:
```bash
curl -X GET "http://localhost:7130/api/database/records/users?limit=10&order=createdAt.desc" \
  -H "x-api-key: YOUR_API_KEY"
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

Example curl (returns empty array):
```bash
curl -X POST http://localhost:7130/api/database/records/users \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '[{
    "name": "John Doe",
    "email": "john@example.com"
  }]'
```

Example curl (returns created record):
```bash
curl -X POST http://localhost:7130/api/database/records/users \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '[{
    "name": "John Doe",
    "email": "john@example.com"
  }]'
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

Example curl (returns empty array):
```bash
curl -X PATCH "http://localhost:7130/api/database/records/users?id=eq.123e4567-e89b-12d3-a456-426614174000" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Doe"
  }'
```

Example curl (returns updated record):
```bash
curl -X PATCH "http://localhost:7130/api/database/records/users?id=eq.123e4567-e89b-12d3-a456-426614174000" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "name": "Jane Doe"
  }'
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

Example curl (no response body):
```bash
curl -X DELETE "http://localhost:7130/api/database/records/users?id=eq.123e4567-e89b-12d3-a456-426614174000" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json"
```

Example curl (returns deleted record or empty array):
```bash
curl -X DELETE "http://localhost:7130/api/database/records/users?id=eq.123e4567-e89b-12d3-a456-426614174000" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
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

## Important Rules

1. **Auto-Generated Fields**
   - `id` - UUID primary key (auto-generated)
   - `createdAt` - Timestamp (auto-set)
   - `updatedAt` - Timestamp (auto-updated)

2. **System Tables**
   - Tables prefixed with `_` are system tables
   - Auth tables (`auth`, `profiles`, `identities`) - use Auth API only

3. **Remember**
   - Schema changes use MCP tools
   - Record operations use REST API
   - All operations need API key authentication