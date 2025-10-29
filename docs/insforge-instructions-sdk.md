# InsForge SDK Documentation - Overview

## What is InsForge?

Backend-as-a-service (BaaS) platform providing:
- **Database**: PostgreSQL with PostgREST API
- **Authentication**: Email/password + OAuth (Google, GitHub)
- **Storage**: File upload/download
- **AI**: Chat completions and image generation (OpenAI-compatible)
- **Functions**: Serverless function deployment

**Key Concept**: InsForge replaces your traditional backend - implement business logic by calling database operations directly instead of building API endpoints.

## Installation

```bash
npm install @insforge/sdk@latest
```

## Initial Setup

**🚨 CRITICAL: Initialize the SDK Client**

You must create a client instance using `createClient()` with your base URL and anon key:

```javascriptn
import { createClient } from '@insforge/sdk';

const client = createClient({
  baseUrl: 'http://localhost:7130',  // Your InsForge backend URL
  anonKey: 'your-anon-key-here'       // Get this from backend metadata
});
```

**API BASE URL**: Your API base URL is `http://localhost:7130`.

## Getting Detailed Documentation

**Use the InsForge `fetch-docs` MCP tool to get specific SDK documentation:**

Available documentation types:
- `"instructions"` - Essential backend setup (START HERE)
- `"db-sdk"` - Database operations with SDK
- `"auth-sdk"` - Authentication methods
- `"storage-sdk"` - File storage operations
- `"functions-sdk"` - Serverless functions invocation
- `"ai-integration-sdk"` - AI chat and image generation

## When to Use SDK vs MCP Tools

### Always SDK for Application Logic:
- Authentication (register, login, logout, profiles)
- Database CRUD (select, insert, update, delete)
- Storage operations (upload, download files)
- AI operations (chat, image generation)
- Serverless function invocation

### Use MCP Tools for Infrastructure:
- Backend setup and metadata (`get-backend-metadata`)
- Database schema management (`run-raw-sql`, `get-table-schema`)
- Storage bucket creation (`create-bucket`, `list-buckets`, `delete-bucket`)
- Serverless function deployment (`create-function`, `update-function`, `delete-function`)

## Quick Start

1. **First**: Call `get-backend-metadata` to check current backend state
2. **Fetch docs**: Use the `fetch-docs` tool with appropriate doc type
3. **Initialize SDK**: Create client with your backend URL
4. **Build**: Use SDK methods for auth, database, storage, AI as needed

## Important Notes

- SDK returns `{data, error}` structure for all operations
- Database inserts require array format: `[{...}]`
- Serverless functions have single endpoint (no subpaths)
- Storage: Upload files to buckets, store URLs in database
- AI operations are OpenAI-compatible