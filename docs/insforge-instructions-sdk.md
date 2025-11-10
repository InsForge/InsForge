# InsForge SDK Documentation - Overview

## What is InsForge?

Backend-as-a-service (BaaS) platform providing:

- **Database**: PostgreSQL with PostgREST API
- **Authentication**: Email/password + OAuth (Google, GitHub)
- **Storage**: File upload/download
- **AI**: Chat completions and image generation (OpenAI-compatible)
- **Functions**: Serverless function deployment

**Key Concept**: InsForge replaces your traditional backend - implement business logic by calling database operations directly instead of building API endpoints.

## Installation of InsForge pre-built frame templates (e.g. React, React Router, Nextjs) with sdk and component package in it

```bash
npx create-insforge-app my-app --frame {your frame} --base-url https://your-app.region.insforge.app --anon-key your-anon-key-here
```

**API BASE URL**: Your API base URL is `https://your-app.region.insforge.app`.

## Getting Detailed Documentation

**🚨 CRITICAL: Always Fetch Documentation Before Writing Code**

Before writing or editing any InsForge integration code, you **MUST** call the `fetch-docs` MCP tool to get the latest SDK documentation. This ensures you have accurate, up-to-date implementation patterns.

**Use the InsForge `fetch-docs` MCP tool to get specific SDK documentation:**

Available documentation types:

- `"instructions"` - Essential backend setup (START HERE)
- `"db-sdk"` - Database operations with SDK
- **Authentication** - Choose based on implementation:
  - `"auth-components-react"` - Frontend auth for React+Vite (built-in auth pages + UI)
  - `"auth-components-nextjs"` - Frontend auth for Next.js (built-in auth pages + UI)
  - `"auth-components-react-router"` - Frontend auth for React(Vite+React Router) (built-in auth pages + UI)
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
2. **Detect framework**: Check user's project to determine the framework (Next.js, React, etc.)
3. **Install pre-built template**: Start from frame-specific template if you are creating a new project 
4. **Fetch docs**: Use `fetch-docs` with the appropriate doc type based on what you're implementing:
   - **Database**: `"db-sdk"` - For database operations
   - **Authentication** (choose based on framework):
     - React(Vite) → `"auth-components-react"`
     - Next.js → `"auth-components-nextjs"`
     - React(Vite+React Router) → `"auth-components-react-router"`
   - **Storage**: `"storage-sdk"` - For file upload/download
   - **AI**: `"ai-integration-sdk"` - For chat completions and image generation
   - **Functions**: `"functions-sdk"` - For serverless functions
5. **Initialize SDK**: Create client with your backend URL
6. **Build**: Use framework-specific Auth Components for auth, SDK methods for database, storage, AI, and functions

## Important Notes

- Use the right framework-specific component package for production-ready auth
- SDK returns `{data, error}` structure for all operations
- Database inserts require array format: `[{...}]`
- Serverless functions have single endpoint (no subpaths)
- Storage: Upload files to buckets, store URLs in database
- AI operations are OpenAI-compatible
