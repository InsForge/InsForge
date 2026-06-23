# Insforge Debug Guide

## When Your API Code Fails

**Start here** → `get-instructions` and `get-backend-metadata` (understand system state)
**Read docs** → `get-db-api`, `get-auth-api`, `get-storage-api` (read ALL of them)
**Check table** → `get-table-schema` with your table name
**Test endpoint** → Use curl with exact API format from docs

## Critical Rule: Read Documentation First

Before debugging, you MUST read all documentation to understand how the API works.

## Common API Issues

**Table created but API fails** → Check field names match schema exactly
**Array required** → PostgREST requires POST requests as arrays `[{...}]`
**Foreign key error** → Parent record must exist before child
**Permission denied** → Write operations need `Authorization: Bearer <accessToken>`
**JWSError** → JWT token expired or invalid - user needs to login again
**PATCH increment fails** → PostgREST doesn't support SQL expressions like `count + 1`

## Debug Workflow

1. **Always** call `get-backend-metadata` first
2. Read the relevant API documentation completely
3. Check your table schema matches your API calls
4. Test with curl using exact format from docs
5. Verify response matches documentation

### Example Debug Tests

```bash
# Test GET endpoint
# Windows PowerShell: use curl.exe
curl -X GET http://localhost:7130/api/database/records/your_table \
  -H "Authorization: Bearer YOUR_TOKEN" | jq .

# Test POST with array format
# Mac/Linux
curl -X POST http://localhost:7130/api/database/records/your_table \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Prefer: return=representation' \
  -d '[{"field": "value"}]' | jq .

# Windows PowerShell (use curl.exe) - different quotes for nested JSON
curl.exe -X POST http://localhost:7130/api/database/records/your_table \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Prefer: return=representation" \
  -d '[{\"field\": \"value\"}]' | jq .
```

## Key Rules

- Backend runs on port 7130
- **READ operations**: No authentication required
- **WRITE operations**: Need `Authorization: Bearer <accessToken>` header
- POST requests must be arrays `[{...}]`
- System tables (prefixed with _) need special APIs
- No escaped characters in JSON
- Login/register returns JWT tokens directly in `accessToken` field

**Remember**: MCP creates the structure, but you must follow API documentation exactly to use it.