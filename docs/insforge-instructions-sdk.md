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
- `"auth-sdk"` - Authentication methods (headless SDK)
- **Authentication UI Components** (framework-specific, production-ready):
  - `"auth-components-nextjs"` - For Next.js applications (App Router + Pages Router)
  - `"auth-components-react"` - For React applications (Vite, Remix, or any React setup)
- `"storage-sdk"` - File storage operations
- `"functions-sdk"` - Serverless functions invocation
- `"ai-integration-sdk"` - AI chat and image generation

**🎯 How to Choose Authentication Documentation:**
1. **Need custom auth logic or headless auth?** → Use `"auth-sdk"`
2. **Building with Next.js?** → Use `"auth-components-nextjs"` (includes middleware, SSR support)
3. **Building with React (Vite/Remix/CRA)?** → Use `"auth-components-react"` (framework-agnostic)

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
InsForge provides framework-specific UI packages that wrap SDK methods into production-ready authentication interfaces:
- `@insforge/nextjs` - Next.js (App Router + Pages Router)
- `@insforge/react` - React (Vite, Remix, or any React setup)
- More frameworks coming soon (Vue, Svelte)

**Use pre-built components when:**
- You want automatic session management and auto-configured OAuth providers
- You want TypeScript-safe, battle-tested authentication flows
- You want to spend less tokens and time to build authentication system

**Components provide:**
- Complete auth pages (SignIn, SignUp) with email/password + OAuth
- Session hooks (`useAuth()`, `useUser()`)
- Route protection (middleware for Next.js, conditional rendering for all)
- Production security (HTTP-only cookies, token sync, email verification)

**Framework selection guide:**
- **Next.js projects** → `@insforge/nextjs` (includes middleware, SSR support, cookie sync)
- **React projects (Vite/Remix/CRA)** → `@insforge/react` (framework-agnostic, works everywhere)

## Quick Start

1. **First**: Call `get-backend-metadata` to check current backend state
2. **Detect framework**: Check user's project to determine the framework (Next.js, React/Vite, etc.)
3. **Fetch docs**: Use `fetch-docs` with the appropriate doc type based on framework:
   - Next.js → `"auth-components-nextjs"`
   - React/Vite/Remix → `"auth-components-react"`
4. **Initialize SDK**: Create client with your backend URL
5. **Build**: Use framework-specific Auth Components for auth, SDK methods for database, storage, AI

## Important Notes

- Use the right framework-specific component package for production-ready auth
- SDK returns `{data, error}` structure for all operations
- Database inserts require array format: `[{...}]`
- Serverless functions have single endpoint (no subpaths)
- Storage: Upload files to buckets, store URLs in database
- AI operations are OpenAI-compatible