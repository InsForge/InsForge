# InsForge API Response Format Examples

All API responses now follow a consistent format with `success` field and proper structure.

## Success Response Format

```json
{
  "success": true,
  "data": <response_data>,
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z",
    "pagination": { // optional, only for list endpoints
      "total": 100,
      "limit": 10,
      "offset": 0,
      "page": 1,
      "totalPages": 10
    }
  }
}
```

## Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {} // optional
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

## Endpoint Examples

### Authentication Endpoints

#### POST /auth/register
**Success Response (201):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "123",
      "email": "user@example.com"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": {
    "code": "ALREADY_EXISTS",
    "message": "User already exists"
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### POST /auth/login
**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "123",
      "name": "John Doe",
      "email": "user@example.com"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Response (401):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid credentials"
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### GET /auth/me
**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "123",
      "email": "user@example.com",
      "type": "user"
    }
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### GET /auth/users
**Success Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "123",
      "email": "user1@example.com",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    },
    {
      "id": "124",
      "email": "user2@example.com",
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Tables Endpoints

#### GET /database/tables
**Success Response (200):**
```json
{
  "success": true,
  "data": ["posts", "comments"],
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### POST /database/tables
**Success Response (201):**
```json
{
  "success": true,
  "data": {
    "message": "Table created successfully",
    "table_name": "posts"
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### GET /database/records/:table
**Success Response with Pagination (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "First Post",
      "content": "Hello World"
    },
    {
      "id": 2,
      "title": "Second Post",
      "content": "Another post"
    }
  ],
  "meta": {
    "pagination": {
      "total": 50,
      "limit": 10,
      "offset": 0,
      "page": 1,
      "totalPages": 5
    },
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### GET /database/records/:table?id=eq.:id
**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "title": "First Post",
    "content": "Hello World",
    "created_at": "2024-01-01T00:00:00.000Z"
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Record not found"
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### POST /database/records/:table
**Success Response (201):**
```json
{
  "success": true,
  "data": {
    "message": "Records inserted successfully",
    "inserted": 3,
    "ids": [1, 2, 3]
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### PATCH /database/records/:table?id=eq.:id
**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Record updated successfully",
    "affected": 1
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### DELETE /database/records/:table?id=eq.:id
**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Record deleted successfully",
    "affected": 1
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### GET /database/tables/:table/schema
**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "table_name": "posts",
    "columns": [
      {
        "name": "id",
        "type": "INTEGER",
        "nullable": false,
        "primary_key": true,
        "default_value": null
      },
      {
        "name": "title",
        "type": "TEXT",
        "nullable": false,
        "primary_key": false,
        "default_value": null
      }
    ]
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### PATCH /database/tables/:table
**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Table schema updated successfully",
    "table_name": "posts",
    "operations": [
      "Added column: tags",
      "Renamed column: content → body",
      "Dropped columns: temp_field"
    ]
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### DELETE /database/tables/:table
**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Table deleted successfully",
    "table_name": "posts"
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Metadata Endpoints

#### GET /metadata
**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "app_name": "My InsForge App",
    "app_description": "Backend as a Service",
    "created_at": "2024-01-01T00:00:00.000Z"
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

#### GET /metadata/api-key
**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "api_key": "ik_1234567890abcdef..."
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### MCP Endpoints

#### GET /mcp/metadata
**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "app_name": "My InsForge App",
    "app_description": "Backend as a Service",
    "mcp_tools": {
      "database": {
        "create_table": true,
        "modify_table": true,
        "delete_table": true,
        "query_records": true,
        "insert_records": true,
        "update_records": true,
        "delete_records": true
      }
    }
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### System Endpoints

#### GET /health
**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "Insforge Backend",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Common Error Codes

- `MISSING_AUTH` - No authentication provided
- `INVALID_AUTH` - Invalid authentication token or API key
- `INVALID_CREDENTIALS` - Wrong username/password
- `TOKEN_EXPIRED` - JWT token has expired
- `FORBIDDEN` - Access denied
- `INSUFFICIENT_PERMISSIONS` - Missing required permissions
- `VALIDATION_ERROR` - Input validation failed
- `INVALID_INPUT` - Invalid input format
- `MISSING_FIELD` - Required field missing
- `NOT_FOUND` - Resource not found
- `ALREADY_EXISTS` - Resource already exists
- `DATABASE_ERROR` - Database operation failed
- `CONSTRAINT_VIOLATION` - Database constraint violated
- `INTERNAL_ERROR` - Internal server error
- `SERVICE_UNAVAILABLE` - Service temporarily unavailable