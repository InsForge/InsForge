---
name: insforge
description: InsForge CLI via curl - substitute for MCP tool calls. Usage: /insforge <command>
user_invocable: true
---

# InsForge CLI

Curl commands that substitute MCP tool calls.

## Setup

Get credentials once via MCP:
```
mcp__insforge__get-backend-metadata
```

Set variables:
- `$URL` = Backend URL
- `$KEY` = API key

---

## Metadata (mcp__insforge__get-backend-metadata)

```bash
curl "$URL/api/metadata" \
  -H "apikey: $KEY"
```

### Get database metadata
```bash
curl "$URL/api/metadata/database" \
  -H "apikey: $KEY"
```

---

## Schema Operations

### List tables (mcp__insforge__get-table-schema with no table)
```bash
curl "$URL/api/database/tables" \
  -H "apikey: $KEY"
```

### Get table schema (mcp__insforge__get-table-schema)
```bash
curl "$URL/api/database/tables/TABLE_NAME" \
  -H "apikey: $KEY"
```

### Create table (mcp__insforge__create-table)
```bash
curl -X POST "$URL/api/database/tables" \
  -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tableName": "posts",
    "columns": [
      {"name": "title", "type": "string", "nullable": false},
      {"name": "content", "type": "string", "nullable": true},
      {"name": "user_id", "type": "uuid", "nullable": false, "foreignKey": {"table": "users", "column": "id", "onDelete": "CASCADE"}}
    ]
  }'
```

Column types: `string`, `integer`, `float`, `boolean`, `datetime`, `uuid`, `json`, `file`

### Modify table (mcp__insforge__modify-table)
```bash
curl -X PATCH "$URL/api/database/tables/TABLE_NAME" \
  -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "addColumns": [{"columnName": "status", "type": "string", "isNullable": true}],
    "dropColumns": ["old_column"],
    "updateColumns": [{"columnName": "title", "newColumnName": "name"}]
  }'
```

### Delete table
```bash
curl -X DELETE "$URL/api/database/tables/TABLE_NAME" \
  -H "apikey: $KEY"
```

---

## Raw SQL (mcp__insforge__run-raw-sql)

### Execute SQL (strict mode)
```bash
curl -X POST "$URL/api/database/advance/rawsql" \
  -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT * FROM posts LIMIT 10"}'
```

### Execute SQL (relaxed mode - allows system tables)
```bash
curl -X POST "$URL/api/database/advance/rawsql/unrestricted" \
  -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT * FROM users"}'
```

### With parameters
```bash
curl -X POST "$URL/api/database/advance/rawsql" \
  -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT * FROM posts WHERE user_id = $1", "params": ["uuid-here"]}'
```

---

## Records (CRUD)

### Query
```bash
curl "$URL/api/database/records/TABLE?limit=10&field=eq.value" \
  -H "apikey: $KEY"
```

### Insert
```bash
curl -X POST "$URL/api/database/records/TABLE" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '[{"field": "value"}]'
```

### Update
```bash
curl -X PATCH "$URL/api/database/records/TABLE?id=eq.UUID" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"field": "newvalue"}'
```

### Delete
```bash
curl -X DELETE "$URL/api/database/records/TABLE?id=eq.UUID" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY"
```

---

## Buckets (mcp__insforge__create-bucket, list-buckets, delete-bucket)

### List buckets
```bash
curl "$URL/api/storage/buckets" \
  -H "apikey: $KEY"
```

### Create bucket
```bash
curl -X POST "$URL/api/storage/buckets" \
  -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"bucketName": "avatars", "isPublic": true}'
```

### Update bucket visibility
```bash
curl -X PATCH "$URL/api/storage/buckets/BUCKET" \
  -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"isPublic": false}'
```

### Delete bucket
```bash
curl -X DELETE "$URL/api/storage/buckets/BUCKET/objects" \
  -H "apikey: $KEY"
```

---

## Storage Objects

### List objects
```bash
curl "$URL/api/storage/buckets/BUCKET/objects" \
  -H "apikey: $KEY"
```

### Upload (auto key)
```bash
curl -X POST "$URL/api/storage/buckets/BUCKET/objects" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -F "file=@/path/to/file"
```

### Upload (specific key)
```bash
curl -X PUT "$URL/api/storage/buckets/BUCKET/objects/KEY" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -F "file=@/path/to/file"
```

### Download
```bash
curl "$URL/api/storage/buckets/BUCKET/objects/KEY" \
  -H "apikey: $KEY" \
  -o output.file
```

### Delete
```bash
curl -X DELETE "$URL/api/storage/buckets/BUCKET/objects/KEY" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY"
```

---

## Functions (mcp__insforge__create-function, get-function, etc.)

### List functions
```bash
curl "$URL/api/functions" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY"
```

### Create function
```bash
curl -X POST "$URL/api/functions" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "hello-world",
    "code": "export default async (req) => new Response(JSON.stringify({message: \"Hello\"}), {headers: {\"Content-Type\": \"application/json\"}})"
  }'
```

### Get function
```bash
curl "$URL/api/functions/SLUG" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY"
```

### Update function
```bash
curl -X PUT "$URL/api/functions/SLUG" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"code": "export default async (req) => new Response(\"Updated\")"}'
```

### Delete function
```bash
curl -X DELETE "$URL/api/functions/SLUG" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY"
```

### Invoke function (client endpoint)
```bash
curl -X POST "$URL/functions/SLUG" \
  -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"arg": "value"}'
```

---

## Database Export/Import

### Export
```bash
curl -X POST "$URL/api/database/advance/export" \
  -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"tables": ["posts", "comments"], "format": "sql", "includeData": true}'
```

### Import SQL
```bash
curl -X POST "$URL/api/database/advance/import" \
  -H "apikey: $KEY" \
  -F "file=@backup.sql" \
  -F "truncate=false"
```

### Bulk upsert (CSV/JSON)
```bash
curl -X POST "$URL/api/database/advance/bulk-upsert" \
  -H "apikey: $KEY" \
  -F "file=@data.csv" \
  -F "table=posts" \
  -F "upsertKey=id"
```

---

## MCP Tool → Curl Mapping

| MCP Tool | Curl Endpoint |
|----------|---------------|
| `get-backend-metadata` | `GET /api/metadata` |
| `get-table-schema` | `GET /api/database/tables/{table}` |
| `create-table` | `POST /api/database/tables` |
| `modify-table` | `PATCH /api/database/tables/{table}` |
| `run-raw-sql` | `POST /api/database/advance/rawsql` |
| `create-bucket` | `POST /api/storage/buckets` |
| `list-buckets` | `GET /api/storage/buckets` |
| `delete-bucket` | `DELETE /api/storage/buckets/{bucket}/objects` |
| `create-function` | `POST /api/functions` |
| `get-function` | `GET /api/functions/{slug}` |
| `update-function` | `PUT /api/functions/{slug}` |
| `delete-function` | `DELETE /api/functions/{slug}` |

---

## Instructions

When `/insforge <command>` is invoked:

1. Get `$URL` and `$KEY` from `mcp__insforge__get-backend-metadata` (cache for session)
2. Build curl from templates above
3. Execute via Bash
4. Return result

**No confirmation. Just execute.**
