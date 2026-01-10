# InsForge Architecture Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Component Architecture](#component-architecture)
4. [Request Flow Patterns](#request-flow-patterns)
5. [Authentication Flow](#authentication-flow)
6. [Database Operations Flow](#database-operations-flow)
7. [Realtime System Flow](#realtime-system-flow)
8. [Storage Flow](#storage-flow)
9. [Function Execution Flow](#function-execution-flow)
10. [Data Flow Diagrams](#data-flow-diagrams)
11. [Technology Stack](#technology-stack)
12. [Design Patterns](#design-patterns)

---

## System Overview

InsForge is a **Backend-as-a-Service (BaaS)** platform designed for AI-assisted development. It provides a complete backend infrastructure with PostgreSQL, authentication, storage, realtime capabilities, serverless functions, and AI integration.

### Key Characteristics
- **Monorepo** structure with npm workspaces
- **Multi-tenant** architecture support (cloud deployments)
- **AI-agent friendly** via Model Context Protocol (MCP)
- **PostgreSQL-centric** with PostgREST auto-API generation
- **Real-time** capabilities via WebSocket (Socket.IO) and PostgreSQL NOTIFY
- **Provider pattern** for extensibility (storage, OAuth, logs)

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
├─────────────────────────────────────────────────────────────────┤
│  AI Agents (MCP)  │  Frontend Dashboard  │  Auth App  │  SDK    │
│  (Claude/Cursor)  │  (React - Port 7131) │ (Port 7132)│         │
└──────────┬───────────────┬───────────────┬─────────────┴─────────┘
           │               │               │
           │               │               │
           ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND API SERVER                            │
│                     (Express - Port 7130)                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              API Routes Layer                             │  │
│  │  /api/auth  │  /api/database  │  /api/storage  │  /api/* │  │
│  └─────────────┬─────────────────┬────────────────┬──────────┘  │
│                │                 │                │              │
│  ┌─────────────▼─────────────────▼────────────────▼──────────┐  │
│  │              Service Layer (Singleton Pattern)             │  │
│  │  AuthService │ DatabaseService │ StorageService │ AIService│  │
│  └─────────────┬─────────────────┬────────────────┬──────────┘  │
│                │                 │                │              │
│  ┌─────────────▼─────────────────▼────────────────▼──────────┐  │
│  │         Infrastructure Layer (Managers)                    │  │
│  │  DatabaseManager │ SocketManager │ RealtimeManager │ etc.  │  │
│  └────────────────────────────────────────────────────────────┘  │
└───────────────────────────┬───────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐  ┌──────────────────┐  ┌─────────────┐
│  PostgreSQL  │  │   PostgREST      │  │   Deno      │
│  (Port 5432) │  │   (Port 5430)    │  │  (Port 7133)│
│              │  │   Auto REST API  │  │  Functions  │
└──────────────┘  └──────────────────┘  └─────────────┘
        │
        │
        ▼
┌───────────────────────────────────────────┐
│       Provider Layer (Abstraction)        │
│  Storage: Local | S3                      │
│  OAuth: Google | GitHub | Discord | etc.  │
│  Logs: Local | CloudWatch                 │
└───────────────────────────────────────────┘
```

---

## Component Architecture

### 1. Backend API Server (`backend/`)

**Core Components:**

```
backend/src/
├── server.ts                 # Express app initialization & route mounting
├── api/
│   ├── routes/              # REST API route handlers
│   │   ├── auth/            # Authentication endpoints
│   │   ├── database/        # Database operations (tables, records, SQL)
│   │   ├── storage/         # File upload/download
│   │   ├── ai/              # AI chat/image generation
│   │   ├── functions/       # Serverless function management
│   │   ├── realtime/        # Realtime channels/messages
│   │   └── ...
│   └── middlewares/         # Auth, error handling, rate limiting
├── services/                # Business logic layer (Singleton pattern)
│   ├── auth/                # User management, OAuth, sessions
│   ├── database/            # Table/record operations
│   ├── storage/             # File operations
│   ├── ai/                  # AI model interactions
│   ├── realtime/            # Channel/message management
│   └── ...
├── infra/                   # Infrastructure layer
│   ├── database/            # DatabaseManager (connection pool)
│   ├── socket/              # SocketManager (WebSocket)
│   ├── realtime/            # RealtimeManager (pg_notify listener)
│   ├── security/            # TokenManager, EncryptionManager
│   └── ...
├── providers/               # Provider abstractions
│   ├── storage/             # BaseStorageProvider, LocalStorage, S3Storage
│   ├── oauth/               # OAuth providers (Google, GitHub, etc.)
│   ├── logs/                # Log providers (Local, CloudWatch)
│   └── ...
└── types/                   # TypeScript type definitions
```

**Service Pattern:**
All services use the **Singleton pattern** for global state management:
    
```typescript
export class MyService {
  private static instance: MyService;
  private pool: Pool | null = null;

  private constructor() {} // Private constructor

  public static getInstance(): MyService {
    if (!MyService.instance) {
      MyService.instance = new MyService();
    }
    return MyService.instance;
  }
}
```

### 2. Frontend Dashboard (`frontend/`)

**Structure:**
```
frontend/src/
├── App.tsx                  # Root component with providers
├── lib/
│   ├── api/                # ApiClient (HTTP client)
│   ├── contexts/           # React contexts (Auth, Socket, Theme)
│   └── routing/            # Route definitions
├── features/               # Feature-based organization
│   ├── dashboard/          # Main dashboard
│   ├── database/           # Database management UI
│   ├── auth/               # User management
│   ├── storage/            # File browser
│   ├── ai/                 # AI configuration
│   ├── functions/          # Function editor
│   ├── realtime/           # Realtime channels
│   └── ...
└── components/             # Shared UI components
```

### 3. Auth App (`auth/`)

Separate React application for authentication pages:
- Sign in/Sign up
- Password reset
- Email verification
- Uses BroadcastChannel API for cross-tab communication

### 4. Shared Schemas (`shared-schemas/`)

**Purpose:** Type safety across backend, frontend, and auth app

```
shared-schemas/src/
├── auth.schema.ts          # Auth request/response types
├── database.schema.ts      # Database types
├── storage.schema.ts       # Storage types
├── realtime.schema.ts      # Realtime types
└── index.ts                # Central exports
```

Uses **Zod** for runtime validation and TypeScript type inference.

---

## Request Flow Patterns

### Generic API Request Flow

```
Client Request
    │
    ▼
┌─────────────────────────────────────┐
│   Express Middleware Stack          │
│   - CORS                            │
│   - Cookie Parser                   │
│   - Rate Limiting                   │
│   - JSON Parser                     │
│   - Request Logging                 │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Route Handler                     │
│   (e.g., /api/database/tables)      │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Authentication Middleware         │
│   - verifyAdmin / verifyUser        │
│   - Extract JWT or API Key          │
│   - Set req.user                    │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Route Handler Logic               │
│   - Validate input (Zod schemas)    │
│   - Call Service Layer              │
│   - Return response                 │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Service Layer                     │
│   - Business logic                  │
│   - Database operations             │
│   - Provider calls                  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Infrastructure Layer              │
│   - DatabaseManager (pool)          │
│   - External APIs                   │
└──────────────┬──────────────────────┘
               │
               ▼
         Response sent
```

---

## Authentication Flow

### 1. Password-Based Authentication

```
┌─────────┐      ┌──────────┐      ┌──────────┐      ┌─────────┐
│ Client  │      │ Backend  │      │ Database │      │ Token   │
│         │      │   API    │      │          │      │ Manager │
└────┬────┘      └────┬─────┘      └────┬─────┘      └────┬────┘
     │                │                 │                 │
     │ POST /auth/sessions              │                 │
     │ {email, password}                │                 │
     ├────────────────>                │                 │
     │                │                 │                 │
     │                │ getUserByEmail()                 │
     │                ├────────────────>                 │
     │                │                 │                │
     │                │ <───────────────┘                │
     │                │                                 │
     │                │ bcrypt.compare()                │
     │                │                                 │
     │                │ generateToken()                 │
     │                ├────────────────────────────────>│
     │                │                JWT              │
     │                │<────────────────────────────────┤
     │                │                                 │
     │ {user, accessToken}                              │
     │<────────────────                                │
     │                                                
```

**Steps:**
1. Client sends email/password to `/api/auth/sessions`
2. Backend validates credentials with database
3. Password verified using bcrypt
4. TokenManager generates JWT token with user info
5. Response includes user object and accessToken
6. Client stores token in localStorage

### 2. OAuth Flow

```
┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌─────────┐
│ Client  │  │ Backend  │  │ OAuth    │  │ Database     │  │ Token   │
│         │  │   API    │  │ Provider │  │              │  │ Manager │
└────┬────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘  └────┬────┘
     │            │              │               │               │
     │ GET /auth/oauth/google                   │               │
     ├───────────>              │               │               │
     │            │             │               │               │
     │ Redirect to Google OAuth                 │               │
     │<───────────              │               │               │
     │            │             │               │               │
     │ [User authorizes on Google]              │               │
     │            │             │               │               │
     │ GET /auth/oauth/callback?code=xxx        │               │
     ├───────────>              │               │               │
     │            │             │               │               │
     │            │ Exchange code for token     │               │
     │            ├────────────>                │               │
     │            │             │               │               │
     │            │ User info   │               │               │
     │            │<────────────                │               │
     │            │             │               │               │
     │            │ Create/Update user          │               │
     │            ├────────────────────────────>│               │
     │            │             │               │               │
     │            │ generateToken()             │               │
     │            ├────────────────────────────────────────────>│
     │            │             │               │   JWT         │
     │            │<────────────────────────────────────────────┤
     │            │             │               │               │
     │ {user, accessToken}                                      │
     │<───────────              │               │               │
```

### 3. Token Verification Flow

```
Request with Authorization: Bearer <token>
    │
    ▼
┌──────────────────────────────┐
│ verifyAdmin/verifyUser       │
│ Middleware                   │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ Extract Bearer Token         │
│ from Authorization header    │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ TokenManager.verifyToken()   │
│ - Verify signature           │
│ - Check expiration           │
│ - Extract payload            │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ Set req.user = {             │
│   id, email, role            │
│ }                            │
└───────────┬──────────────────┘
            │
            ▼
    Continue to route handler
```

---

## Database Operations Flow

### 1. Table Creation Flow

```
POST /api/database/tables
    │
    ▼
┌──────────────────────────────┐
│ DatabaseTablesRouter         │
│ verifyAdmin middleware       │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ DatabaseTableService         │
│ .createTable()               │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ DatabaseManager.getPool()    │
│ Get connection from pool     │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ Execute SQL:                 │
│ CREATE TABLE ...             │
│ NOTIFY pgrst, 'reload schema'│
│ Enable RLS if needed         │
│ Create updated_at trigger    │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ PostgREST automatically      │
│ exposes table as REST API    │
└───────────┬──────────────────┘
            │
            ▼
    Table accessible via
    /api/database/records/{table}
```

### 2. Record Operations (via PostgREST)

```
GET /api/database/records/{table}?select=*&limit=10
    │
    ▼
┌──────────────────────────────┐
│ DatabaseRecordsRouter        │
│ .forwardToPostgrest()        │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ Extract user token           │
│ Convert to PostgREST format  │
│ Set Authorization header     │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ Proxy to PostgREST           │
│ http://postgrest:3000/{table}│
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ PostgREST                    │
│ - Validates token            │
│ - Applies RLS policies       │
│ - Executes query             │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ PostgreSQL                   │
│ - Executes SQL               │
│ - Returns rows               │
└───────────┬──────────────────┘
            │
            ▼
    Response with JSON data
```

**Key Points:**
- PostgREST automatically generates REST API from PostgreSQL schema
- Row Level Security (RLS) policies enforce permissions
- JWT tokens are passed through to PostgREST for authorization
- Table changes trigger `NOTIFY pgrst, 'reload schema'` to refresh PostgREST cache

---

## Realtime System Flow

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Realtime System                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐         ┌──────────────────┐             │
│  │   Client     │         │   Backend API    │             │
│  │  (Frontend)  │         │                  │             │
│  └──────┬───────┘         └────────┬─────────┘             │
│         │                          │                        │
│         │ WebSocket Connection     │                        │
│         │ (Socket.IO)              │                        │
│         ├─────────────────────────>│                        │
│         │                          │                        │
│         │ subscribe('channel:news')│                        │
│         ├─────────────────────────>│                        │
│         │                          │                        │
│  ┌──────▼───────┐         ┌────────▼─────────┐             │
│  │ SocketManager│         │RealtimeChannel   │             │
│  │              │         │Service           │             │
│  │ Join room:   │         │                  │             │
│  │ realtime:news│         │ Create channel   │             │
│  └──────┬───────┘         │ in database      │             │
│         │                 └────────┬─────────┘             │
│         │                          │                        │
│         │                    ┌─────▼──────┐                │
│         │                    │ PostgreSQL │                │
│         │                    │  (realtime │                │
│         │                    │  schema)   │                │
│         │                    └─────┬──────┘                │
│         │                          │                        │
│         │                    ┌─────▼──────────┐            │
│         │                    │ RealtimeManager│            │
│         │                    │ (pg_notify     │            │
│         │                    │  listener)     │            │
│         │                    └─────┬──────────┘            │
│         │                          │                        │
│         │                    LISTEN realtime_message       │
│         │                    ──────────────────            │
│         │                          │                        │
│  ┌──────▼──────────────────────────▼──────────┐            │
│  │  Message Published via realtime.publish()   │            │
│  │  ──────────────────────────────────────────│            │
│  │  1. Insert into realtime.messages          │            │
│  │  2. NOTIFY realtime_message, message_id    │            │
│  └──────┬──────────────────────────────────────┘            │
│         │                                                  │
│         │ pg_notify received                               │
│         │                                                  │
│  ┌──────▼──────────────────────────────────┐               │
│  │ RealtimeManager.handlePGNotification()  │               │
│  │                                          │               │
│  │ 1. Fetch message from DB                │               │
│  │ 2. Fetch channel config                 │               │
│  │ 3. Publish to WebSocket room            │               │
│  │ 4. Send to webhook URLs (if configured) │               │
│  │ 5. Update delivery stats                │               │
│  └──────┬──────────────────────────────────┘               │
│         │                                                  │
│         │ SocketManager.broadcastToRoom()                  │
│         │                                                  │
│  ┌──────▼───────┐                                          │
│  │ SocketManager│                                          │
│  │ .emit() to   │                                          │
│  │ room:        │                                          │
│  │ realtime:news│                                          │
│  └──────┬───────┘                                          │
│         │                                                  │
│         │ Event: 'channel:news'                            │
│         │ Payload: {...}                                   │
│         ├─────────────────────────────────────────────────>│
│         │                                                  │
│  ┌──────▼───────┐                                          │
│  │   Client     │                                          │
│  │ Receives     │                                          │
│  │ realtime     │                                          │
│  │ message      │                                          │
│  └──────────────┘                                          │
└──────────────────────────────────────────────────────────────┘
```

### Detailed Flow

1. **Client Subscription:**
   - Frontend connects via Socket.IO
   - Authenticates with JWT token
   - Sends `subscribe` event with channel name
   - SocketManager joins client to room: `realtime:{channelName}`

2. **Message Publishing:**
   - Backend calls `realtime.publish()` function
   - Message inserted into `realtime.messages` table
   - PostgreSQL trigger calls `NOTIFY realtime_message, message_id`

3. **Message Delivery:**
   - RealtimeManager receives pg_notify
   - Fetches message and channel config from database
   - Publishes to WebSocket room via SocketManager
   - Optionally sends HTTP POST to webhook URLs
   - Updates message delivery statistics

**Key Components:**
- **SocketManager**: WebSocket connection management (Socket.IO)
- **RealtimeManager**: PostgreSQL LISTEN/NOTIFY handler
- **RealtimeChannelService**: Channel CRUD operations
- **RealtimeMessageService**: Message CRUD operations

---

## Storage Flow

### Upload Flow

```
POST /api/storage/{bucket}/upload
    │
    ▼
┌──────────────────────────────┐
│ StorageRouter                │
│ verifyUserOrApiKey           │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ StorageService.uploadFile()  │
│ - Validate bucket exists     │
│ - Generate unique object key │
│ - Get storage provider       │
└───────────┬──────────────────┘
            │
            ├──────────────────┐
            │                  │
            ▼                  ▼
    ┌──────────────┐  ┌──────────────┐
    │ LocalStorage │  │  S3Storage   │
    │  Provider    │  │  Provider    │
    └──────┬───────┘  └──────┬───────┘
           │                 │
           │                 │
           ▼                 ▼
    ┌──────────────┐  ┌──────────────┐
    │ Write to     │  │ Upload to    │
    │ local disk   │  │ S3 bucket    │
    └──────┬───────┘  └──────┬───────┘
           │                 │
           └────────┬────────┘
                    │
                    ▼
┌──────────────────────────────┐
│ Insert record into           │
│ storage.files table          │
│ (bucket, key, size, etc.)    │
└───────────┬──────────────────┘
            │
            ▼
    Return file metadata
```

**Provider Pattern:**
- `BaseStorageProvider` abstract class
- `LocalStorageProvider` - filesystem storage
- `S3StorageProvider` - AWS S3 storage
- Provider selected at runtime based on `AWS_S3_BUCKET` env var

---

## Function Execution Flow

```
POST /functions/{slug}
    │
    ▼
┌──────────────────────────────┐
│ Backend Proxy                │
│ /functions/:slug route       │
└───────────┬──────────────────┘
            │
            │ Proxy to Deno runtime
            │
            ▼
┌──────────────────────────────┐
│ Deno Runtime (Port 7133)     │
│ functions/server.ts          │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ 1. Fetch function code       │
│    FROM functions.definitions│
│    WHERE slug = {slug}       │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ 2. Fetch and decrypt secrets │
│    FROM system.secrets       │
│    Decrypt with ENCRYPTION_KEY│
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ 3. Create worker environment │
│    - Inject secrets as env   │
│    - Inject database client  │
│    - Inject PostgREST client │
└───────────┬──────────────────┘
            │
            ▼
┌──────────────────────────────┐
│ 4. Execute function code     │
│    Deno.run() in sandbox     │
│    with timeout (60s default)│
└───────────┬──────────────────┘
            │
            ▼
    Return response to client
```

**Function Code Template:**
Functions receive pre-configured:
- `Deno.env` - Environment variables (decrypted secrets)
- `dbClient` - PostgreSQL client
- `postgrestClient` - PostgREST HTTP client

---

## Data Flow Diagrams

### Complete Request Cycle (Create User Example)

```
1. CLIENT REQUEST
   ┌─────────────────┐
   │ Frontend/API    │
   │ POST /api/auth/users
   │ {email, password}
   └────────┬────────┘
            │
            ▼
2. MIDDLEWARE STACK
   ┌─────────────────┐
   │ CORS            │
   │ Cookie Parser   │
   │ Rate Limiter    │
   │ JSON Parser     │
   └────────┬────────┘
            │
            ▼
3. AUTHENTICATION
   ┌─────────────────┐
   │ verifyAdmin()   │
   │ Extract JWT     │
   │ Verify token    │
   │ Set req.user    │
   └────────┬────────┘
            │
            ▼
4. ROUTE HANDLER
   ┌─────────────────┐
   │ AuthRouter      │
   │ Validate input  │
   │ (Zod schema)    │
   └────────┬────────┘
            │
            ▼
5. SERVICE LAYER
   ┌─────────────────┐
   │ AuthService     │
   │ .register()     │
   │ - Hash password │
   │ - Create user   │
   │ - Generate token│
   └────────┬────────┘
            │
            ▼
6. DATABASE
   ┌─────────────────┐
   │ DatabaseManager │
   │ Get connection  │
   │ from pool       │
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │ PostgreSQL      │
   │ INSERT INTO     │
   │ auth.users      │
   └────────┬────────┘
            │
            ▼
7. RESPONSE
   ┌─────────────────┐
   │ Return to client│
   │ {user, token}   │
   └─────────────────┘
```

---

## Technology Stack

### Backend
- **Runtime**: Node.js (ESM modules)
- **Framework**: Express.js
- **Database**: PostgreSQL 15
- **Database ORM/Query**: pg (node-postgres) with connection pooling
- **Auto REST API**: PostgREST
- **WebSocket**: Socket.IO
- **Authentication**: JWT (HS256) via jose/jsonwebtoken
- **Password Hashing**: bcryptjs
- **Validation**: Zod schemas
- **Logging**: Winston
- **Migrations**: node-pg-migrate

### Frontend
- **Framework**: React 19
- **Build Tool**: Vite
- **State Management**: React Query (@tanstack/react-query)
- **Routing**: React Router
- **UI Components**: Radix UI
- **Styling**: Tailwind CSS
- **WebSocket Client**: socket.io-client
- **HTTP Client**: Fetch API (custom ApiClient wrapper)

### Infrastructure
- **Containerization**: Docker & Docker Compose
- **Function Runtime**: Deno
- **Log Collection**: Vector.dev
- **File Storage**: Local filesystem or AWS S3

### Development Tools
- **Language**: TypeScript
- **Linting**: ESLint
- **Formatting**: Prettier
- **Testing**: Vitest (unit), Shell scripts (E2E)
- **Monorepo**: npm workspaces

---

## Design Patterns

### 1. Singleton Pattern
All services and managers use singleton pattern:
- Ensures single instance
- Centralized state management
- Lazy initialization

### 2. Provider Pattern
Abstraction for external services:
- Storage providers (Local, S3)
- OAuth providers (Google, GitHub, etc.)
- Log providers (Local, CloudWatch)
- Allows easy extension without changing core code

### 3. Service Layer Pattern
Business logic separated from route handlers:
- Routes → Services → Infrastructure
- Clear separation of concerns
- Easier testing and maintenance

### 4. Middleware Pattern
Express middleware chain:
- Authentication
- Error handling
- Request logging
- Rate limiting

### 5. Repository Pattern (implicit)
Database operations abstracted through managers:
- DatabaseManager handles connection pooling
- Services use managers, not direct DB access

### 6. Factory Pattern
Provider selection based on configuration:
```typescript
const provider = s3Bucket 
  ? new S3StorageProvider(...)
  : new LocalStorageProvider(...)
```

---

## Database Schema Organization

```
PostgreSQL Database
├── public schema
│   └── User-created tables (via API)
│
├── auth schema
│   ├── users
│   ├── user_providers (OAuth links)
│   ├── auth_config
│   ├── oauth_configs
│   └── email_otps
│
├── system schema
│   ├── secrets (API keys, encrypted)
│   ├── audit_logs
│   ├── mcp_usage
│   └── migrations
│
├── storage schema
│   ├── buckets
│   └── files
│
├── functions schema
│   └── definitions
│
└── realtime schema
    ├── channels
    ├── messages
    └── permissions
```

**Key Points:**
- User tables in `public` schema (exposed via PostgREST)
- System tables in `system` schema (not exposed)
- Auth tables in `auth` schema
- Realtime tables in `realtime` schema
- Row Level Security (RLS) enabled on user tables by default

---

## Summary

InsForge follows a **layered architecture** with clear separation:

1. **Client Layer**: Frontend, Auth app, MCP clients
2. **API Layer**: Express routes and middleware
3. **Service Layer**: Business logic (Singleton services)
4. **Infrastructure Layer**: Database, WebSocket, Realtime managers
5. **Provider Layer**: External service abstractions
6. **Database Layer**: PostgreSQL with PostgREST

**Key Flows:**
- **Authentication**: JWT-based with OAuth support
- **Database**: PostgREST auto-API with RLS
- **Realtime**: PostgreSQL NOTIFY → RealtimeManager → Socket.IO
- **Storage**: Provider pattern (Local/S3)
- **Functions**: Deno runtime with encrypted secrets

This architecture provides:
- ✅ Scalability (connection pooling, stateless services)
- ✅ Security (RLS, JWT, encrypted secrets)
- ✅ Extensibility (provider pattern, plugin architecture)
- ✅ Maintainability (clear layers, singleton services)
- ✅ Type Safety (TypeScript + Zod schemas)






