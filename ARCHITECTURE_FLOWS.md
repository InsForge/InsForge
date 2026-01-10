# InsForge Flow Diagrams

This document provides visual flow diagrams for key operations in InsForge.

## Authentication Flow (Password)

```
┌──────────┐                                          ┌─────────────┐
│  Client  │                                          │   Backend   │
│          │                                          │    API      │
└────┬─────┘                                          └──────┬──────┘
     │                                                       │
     │ POST /api/auth/sessions                              │
     │ { email, password }                                  │
     ├─────────────────────────────────────────────────────>│
     │                                                       │
     │                                                       │ ┌─────────────────┐
     │                                                       │ │ AuthService     │
     │                                                       │ │ .login()        │
     │                                                       │ └────────┬────────┘
     │                                                       │          │
     │                                                       │          │ ┌──────────────┐
     │                                                       │          │ │ Database     │
     │                                                       │          │ │ getUserByEmail│
     │                                                       │          ├─>              │
     │                                                       │          │<─              │
     │                                                       │          │ └──────────────┘
     │                                                       │          │
     │                                                       │          │ bcrypt.compare()
     │                                                       │          │
     │                                                       │          │ ┌──────────────┐
     │                                                       │          │ │ TokenManager │
     │                                                       │          │ │ generateToken│
     │                                                       │          ├─>              │
     │                                                       │          │<─ JWT Token    │
     │                                                       │          │ └──────────────┘
     │                                                       │          │
     │ { user, accessToken, csrfToken }                     │          │
     │<─────────────────────────────────────────────────────┤          │
     │                                                       │          │
     │                                                       │          │
```

## OAuth Flow

```
┌──────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│  Client  │  │   Backend   │  │    OAuth     │  │   Database   │
│          │  │    API      │  │   Provider   │  │              │
└────┬─────┘  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘
     │                │                 │                 │
     │ GET /auth/oauth/google          │                 │
     ├───────────────>│                │                 │
     │                │                │                 │
     │ Redirect to OAuth Provider      │                 │
     │<───────────────┤                │                 │
     │                │                │                 │
     │ [User authorizes]               │                 │
     │                │                │                 │
     │ GET /auth/oauth/callback?code=xxx                 │
     ├───────────────>│                │                 │
     │                │                │                 │
     │                │ Exchange code for access token   │
     │                ├───────────────>│                 │
     │                │                │                 │
     │                │ User info (email, name, etc.)    │
     │                │<───────────────┤                 │
     │                │                │                 │
     │                │ Create/Update user in DB         │
     │                ├─────────────────────────────────>│
     │                │                │                 │
     │                │<─────────────────────────────────┤
     │                │                │                 │
     │                │ Generate JWT token               │
     │                │                                 │
     │ { user, accessToken }                             │
     │<───────────────┤                │                 │
     │                │                │                 │
```

## Database Table Creation Flow

```
┌──────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│  Client  │  │   Backend   │  │  Database    │  │  PostgREST   │
│          │  │    API      │  │  Service     │  │              │
└────┬─────┘  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘
     │                │                 │                 │
     │ POST /api/database/tables        │                 │
     │ { name, columns, useRLS }        │                 │
     ├───────────────>│                 │                 │
     │                │                 │                 │
     │                │ DatabaseTableService.createTable()│
     │                ├────────────────>│                 │
     │                │                 │                 │
     │                │                 │ CREATE TABLE ...│
     │                │                 ├────────────────>│
     │                │                 │                 │
     │                │                 │ NOTIFY pgrst, 'reload schema'
     │                │                 ├───────────────────────────>│
     │                │                 │                 │
     │                │                 │<───────────────────────────┤
     │                │                 │                 │
     │                │                 │ Enable RLS (if useRLS)     │
     │                │                 │ Create updated_at trigger  │
     │                │                 │                 │
     │                │                 │<────────────────           │
     │                │                 │                 │
     │ { message, tableName, columns }  │                 │
     │<───────────────┤                 │                 │
     │                │                 │                 │
     │                │                 │ PostgREST now exposes table│
     │                │                 │ as REST API automatically  │
     │                │                 │                 │
```

## Record Operations via PostgREST

```
┌──────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│  Client  │  │   Backend   │  │  PostgREST   │  │  PostgreSQL  │
│          │  │    API      │  │   (Auto API) │  │              │
└────┬─────┘  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘
     │                │                 │                 │
     │ GET /api/database/records/users?select=*&limit=10 │
     ├───────────────>│                 │                 │
     │                │                 │                 │
     │                │ Extract JWT token                 │
     │                │ Convert to PostgREST format       │
     │                │                 │                 │
     │                │ Proxy to PostgREST                │
     │                ├──────────────────────────────────>│
     │                │                 │                 │
     │                │                 │ Validate JWT    │
     │                │                 │ Apply RLS       │
     │                │                 ├────────────────>│
     │                │                 │                 │
     │                │                 │ SELECT * FROM users LIMIT 10
     │                │                 │<────────────────┤
     │                │                 │                 │
     │                │                 │ JSON rows       │
     │                │<──────────────────────────────────┤
     │                │                 │                 │
     │ JSON response  │                 │                 │
     │<───────────────┤                 │                 │
     │                │                 │                 │
```

## Realtime Message Publishing Flow

```
┌──────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│  Client  │  │   Backend   │  │ RealtimeMgr  │  │  PostgreSQL  │
│          │  │    API      │  │              │  │              │
└────┬─────┘  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘
     │                │                 │                 │
     │ Subscribe to channel via WebSocket                 │
     │                │                 │                 │
     │ POST /api/realtime/channels/{id}/messages          │
     │ { eventName, payload }            │                 │
     ├───────────────>│                 │                 │
     │                │                 │                 │
     │                │ RealtimeMessageService.publish()  │
     │                ├────────────────>│                 │
     │                │                 │                 │
     │                │                 │ INSERT INTO realtime.messages
     │                │                 ├────────────────>│
     │                │                 │                 │
     │                │                 │ Trigger: NOTIFY realtime_message, id
     │                │                 │<────────────────┤
     │                │                 │                 │
     │                │                 │ pg_notify received
     │                │                 │ (RealtimeManager listener)
     │                │                 │                 │
     │                │ Fetch message & channel config    │
     │                │                 ├────────────────>│
     │                │                 │                 │
     │                │                 │<────────────────┤
     │                │                 │                 │
     │                │ Publish to WebSocket room         │
     │                │ SocketManager.broadcastToRoom()   │
     │                │                 │                 │
     │ Event received via WebSocket                       │
     │<───────────────┤                 │                 │
     │                │                 │                 │
     │                │ Update delivery stats             │
     │                │                 ├────────────────>│
     │                │                 │                 │
```

## Storage Upload Flow

```
┌──────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│  Client  │  │   Backend   │  │   Storage    │  │   Provider   │
│          │  │    API      │  │   Service    │  │ (Local/S3)   │
└────┬─────┘  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘
     │                │                 │                 │
     │ POST /api/storage/{bucket}/upload                  │
     │ (multipart/form-data)             │                 │
     ├───────────────>│                 │                 │
     │                │                 │                 │
     │                │ StorageService.uploadFile()       │
     │                ├────────────────>│                 │
     │                │                 │                 │
     │                │                 │ Validate bucket │
     │                │                 │ Generate key    │
     │                │                 │                 │
     │                │                 │ Upload to provider
     │                │                 ├────────────────>│
     │                │                 │                 │
     │                │                 │ [Local: Write to disk]
     │                │                 │ [S3: Upload to S3]
     │                │                 │<────────────────┤
     │                │                 │                 │
     │                │                 │ Insert into storage.files
     │                │                 │                 │
     │ { file: { bucket, key, size, url } }               │
     │<───────────────┤                 │                 │
     │                │                 │                 │
```

## Function Execution Flow

```
┌──────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│  Client  │  │   Backend   │  │ Deno Runtime │  │  PostgreSQL  │
│          │  │    API      │  │   (Port 7133)│  │              │
└────┬─────┘  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘
     │                │                 │                 │
     │ POST /functions/my-function                       │
     │ { data }                          │                 │
     ├───────────────>│                 │                 │
     │                │                 │                 │
     │                │ Proxy to Deno runtime            │
     │                ├──────────────────────────────────>│
     │                │                 │                 │
     │                │                 │ Fetch function code
     │                │                 ├────────────────>│
     │                │                 │                 │
     │                │                 │ SELECT code FROM functions.definitions
     │                │                 │<────────────────┤
     │                │                 │                 │
     │                │                 │ Fetch & decrypt secrets
     │                │                 ├────────────────>│
     │                │                 │                 │
     │                │                 │ SELECT * FROM system.secrets
     │                │                 │<────────────────┤
     │                │                 │                 │
     │                │                 │ Decrypt with ENCRYPTION_KEY
     │                │                 │                 │
     │                │                 │ Execute function code
     │                │                 │ (with timeout: 60s)
     │                │                 │                 │
     │                │                 │ Function runs with:
     │                │                 │ - Deno.env (secrets)
     │                │                 │ - dbClient (PostgreSQL)
     │                │                 │ - postgrestClient
     │                │                 │                 │
     │                │ Function response                 │
     │                │<──────────────────────────────────┤
     │                │                 │                 │
     │ Response       │                 │                 │
     │<───────────────┤                 │                 │
     │                │                 │                 │
```

## Request Authentication Flow

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
            │
            ▼
┌──────────────────────────────┐
│ Check if token starts with   │
│ 'ik_' (API key format)       │
└───────────┬──────────────────┘
            │
      ┌─────┴─────┐
      │           │
    Yes           No
      │           │
      ▼           ▼
┌──────────┐  ┌──────────────┐
│ Verify   │  │ TokenManager │
│ API Key  │  │ .verifyToken │
│ via      │  │ (JWT)        │
│ Secret   │  └──────┬───────┘
│ Service  │         │
└────┬─────┘         │
     │          ┌────┴────┐
     │          │         │
     │      Valid      Invalid
     │          │         │
     │          ▼         ▼
     │     ┌──────────┐  ┌──────────┐
     │     │ Extract  │  │ Return   │
     │     │ payload  │  │ 401      │
     │     │ (sub,    │  │ Error    │
     │     │ email,   │  └──────────┘
     │     │ role)    │
     │     └────┬─────┘
     │          │
     └──────┬───┘
            │
            ▼
┌──────────────────────────────┐
│ Set req.user = {             │
│   id: payload.sub,           │
│   email: payload.email,      │
│   role: payload.role         │
│ }                            │
│                              │
│ Set req.authenticated = true │
└───────────┬──────────────────┘
            │
            ▼
    Continue to route handler
```

## WebSocket Connection Flow

```
┌──────────┐                                          ┌─────────────┐
│  Client  │                                          │   Backend   │
│(Frontend)│                                          │ SocketManager│
└────┬─────┘                                          └──────┬──────┘
     │                                                       │
     │ socket.connect('http://api', { auth: { token } })    │
     ├─────────────────────────────────────────────────────>│
     │                                                       │
     │                                                       │ ┌─────────────┐
     │                                                       │ │ Middleware  │
     │                                                       │ │ Verify JWT  │
     │                                                       │ └──────┬──────┘
     │                                                       │        │
     │                                                       │ Extract user from token
     │                                                       │        │
     │                                                       │ ┌──────▼──────┐
     │                                                       │ │ Create      │
     │                                                       │ │ SocketMetadata│
     │                                                       │ └──────┬──────┘
     │                                                       │        │
     │                                                       │ Join rooms:
     │                                                       │ - user:{userId}
     │                                                       │ - role:{role}
     │                                                       │        │
     │                                                       │ ┌──────▼──────┐
     │                                                       │ │ Store in    │
     │                                                       │ │ socketMetadata│
     │                                                       │ │ Map         │
     │                                                       │ └──────┬──────┘
     │                                                       │        │
     │ 'connected' event                                     │        │
     │<─────────────────────────────────────────────────────┤        │
     │                                                       │        │
     │                                                       │        │
     │ Client can now:                                      │        │
     │ - subscribe to channels                              │        │
     │ - publish messages                                   │        │
     │ - receive realtime updates                           │        │
     │                                                       │        │
```

## Realtime Subscription Flow

```
┌──────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│  Client  │  │ SocketManager│  │ RealtimeChannel│ │  PostgreSQL  │
│          │  │              │  │   Service    │  │              │
└────┬─────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
     │                │                 │                 │
     │ socket.emit('subscribe', { channel: 'news' })      │
     ├────────────────>│                 │                 │
     │                │                 │                 │
     │                │ Verify channel exists & enabled   │
     │                ├──────────────────────────────────>│
     │                │                 │                 │
     │                │                 │ SELECT * FROM realtime.channels
     │                │                 │<────────────────┤
     │                │                 │                 │
     │                │ Check permissions                 │
     │                │                 │                 │
     │                │ Join socket to room:              │
     │                │ realtime:news    │                 │
     │                │                 │                 │
     │                │ Update socketMetadata             │
     │                │ subscriptions.add('news')         │
     │                │                 │                 │
     │ { success: true, channel: 'news' }                 │
     │<────────────────┤                 │                 │
     │                │                 │                 │
     │ Client is now subscribed to 'news' channel         │
     │ Will receive all messages published to this channel│
     │                │                 │                 │
```






