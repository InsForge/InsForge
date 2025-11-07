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
  baseUrl: 'https://your-app.region.insforge.app',  // Your InsForge backend URL
  anonKey: 'your-anon-key-here'       // Get this from backend metadata
});
```

**API BASE URL**: Your API base URL is `https://your-app.region.insforge.app`.

## Getting Detailed Documentation

**Use the InsForge `fetch-docs` MCP tool to get specific SDK documentation:**

Available documentation types:
- `"instructions"` - Essential backend setup (START HERE)
- `"db-sdk"` - Database operations with SDK
- **Authentication** - Choose based on implementation:
  - `"auth-sdk"` - Backend/headless auth (SDK methods only)
  - `"auth-components-nextjs"` - Frontend auth for Next.js (built-in auth pages + UI)
  - `"auth-components-react-router"` - Frontend auth for React(Vite+React Router) (built-in auth pages + UI)
- `"storage-sdk"` - File storage operations
- `"functions-sdk"` - Serverless functions invocation
- `"ai-integration-sdk"` - AI chat and image generation

**🎯 How to Choose Authentication Documentation:**
1. **Building with Next.js?** → Use `"auth-components-nextjs"` (frontend: built-in auth pages)
2. **Building with React (Vite+React Router)?** → Use `"auth-components-react-router"` (frontend: built-in auth pages)

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

### When to Use Pre-Built Components
InsForge provides framework-specific UI packages with **built-in auth pages** (zero UI code):
- `@insforge/nextjs` - Next.js (built-in auth + middleware + SSR)
- `@insforge/react-router` - React (built-in auth + framework-agnostic)

## Quick Start

1. **First**: Call `get-backend-metadata` to check current backend state
2. **Detect framework**: Check user's project to determine the framework (Next.js, React, etc.)
3. **Fetch docs**: Use `fetch-docs` with the appropriate doc type based on framework:
   - Next.js → `"auth-components-nextjs"`
   - React(Vite+React Router) → `"auth-components-react-router"`
4. **Initialize SDK**: Create client with your backend URL
5. **Build**: Use framework-specific Auth Components for auth, SDK methods for database, storage, AI

## Important Notes

- Use the right framework-specific component package for production-ready auth
- SDK returns `{data, error}` structure for all operations
- Database inserts require array format: `[{...}]`
- Serverless functions have single endpoint (no subpaths)
- Storage: Upload files to buckets, store URLs in database
- AI operations are OpenAI-compatible