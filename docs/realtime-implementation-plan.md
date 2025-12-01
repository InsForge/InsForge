# Realtime Feature Implementation

## Overview

InsForge's realtime feature allows developers to:
1. Define channels with authentication policies via RLS on messages table
2. Publish events to channels via `insforge_realtime.publish()` from custom triggers (system messages)
3. Publish events from WebSocket clients (user messages)
4. Deliver events to WebSocket subscribers and/or webhook URLs
5. Track message history and delivery statistics

---

## Architecture Design

### Schema: `insforge_realtime`

All realtime-related system tables live in a dedicated schema.

### Tables

| Table | Purpose |
|-------|---------|
| `insforge_realtime.channels` | Channel definitions with webhook configuration |
| `insforge_realtime.messages` | All messages with delivery statistics (RLS for permissions) |

### Permission Model (Supabase Pattern)

Permissions are controlled via RLS policies on the `messages` table:
- **SELECT policy** = subscribe permission (can subscribe to channel)
- **INSERT policy** = publish permission (can publish to channel)

Session variables for RLS:
- `request.jwt.claim.sub` = user ID
- `request.jwt.claim.role` = user role
- `realtime.channel_name` = channel being accessed

### Event Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SYSTEM-TRIGGERED EVENTS                              │
│                    (Database trigger calls publish())                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ PERFORM insforge_realtime.publish(channel, event, payload)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      insforge_realtime.publish()                             │
│  1. Find matching channel (exact or wildcard pattern)                        │
│  2. Insert message record (sender_type = 'system')                           │
│  3. pg_notify('insforge_realtime', {...})                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ LISTEN 'insforge_realtime'
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REALTIME MANAGER                                   │
│  1. Lookup channel config (exists? enabled? webhook urls?)                   │
│  2. Emit to WebSocket: broadcast to Socket.IO room                           │
│  3. Emit to Webhooks: POST to each configured URL                            │
│  4. Update message record with delivery counts                               │
└─────────────────────────────────────────────────────────────────────────────┘
                          │                           │
                          ▼                           ▼
              ┌─────────────────────┐     ┌─────────────────────┐
              │  WebSocket Clients  │     │   Webhook Endpoints │
              └─────────────────────┘     └─────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLIENT-INITIATED EVENTS                              │
│                    (WebSocket client sends message)                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ realtime:publish { channel, event, payload }
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SOCKET MANAGER                                     │
│  1. Check client is subscribed to channel                                    │
│  2. Delegate to RealtimeManager.broadcastClientMessage()                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REALTIME MANAGER                                   │
│  1. Insert message via RealtimeMessageService (sender_type = 'user')         │
│     - RLS INSERT policy controls who can publish                             │
│  2. If RLS denies: return error to client                                    │
│  3. If RLS allows: broadcast to WebSocket room (no webhooks)                 │
│  4. Update message record with delivery stats                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                      ┌─────────────────────┐
                      │  WebSocket Clients  │
                      │   (NO webhooks)     │
                      └─────────────────────┘
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Schema | `insforge_realtime` | Isolate realtime tables from user tables |
| Permission model | RLS on messages table | SELECT = subscribe, INSERT = publish (Supabase pattern) |
| Event creation | Developer triggers OR client WebSocket | Full flexibility |
| Delivery | WebSocket + Webhooks (system only) | Client messages don't trigger webhooks |
| Audit | Messages table | Track all messages with sender info |
| Wildcard syntax | `%` (LIKE pattern) | Native PostgreSQL, less error-prone |
| Sender tracking | `sender_type` + `sender_id` | Distinguish system vs user messages |

---

## Database Schema

### Migration: `017_create-realtime-schema.sql`

```sql
-- Creates the insforge_realtime schema with:
-- 1. channels table - Channel definitions with webhook configuration
-- 2. messages table - All messages with delivery statistics (RLS for permissions)
-- 3. publish() function - Called by developer triggers to publish events

CREATE SCHEMA IF NOT EXISTS insforge_realtime;

-- ============================================================================
-- CHANNELS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS insforge_realtime.channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,        -- Channel pattern (e.g., "orders", "order:%")
  description TEXT,
  webhook_urls TEXT[],              -- URLs to POST events to
  enabled BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================
-- RLS policies control subscribe/publish permissions:
-- - SELECT policy = 'subscribe' permission
-- - INSERT policy = 'publish' permission

CREATE TABLE IF NOT EXISTS insforge_realtime.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_name TEXT NOT NULL,
  channel_id UUID REFERENCES insforge_realtime.channels(id) ON DELETE SET NULL,
  channel_name TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb NOT NULL,

  -- Sender information
  sender_type TEXT DEFAULT 'system' NOT NULL CHECK (sender_type IN ('system', 'user')),
  sender_id UUID,  -- User ID for 'user' type, NULL for 'system' type

  -- Delivery statistics
  ws_audience_count INTEGER DEFAULT 0 NOT NULL,
  wh_audience_count INTEGER DEFAULT 0 NOT NULL,
  wh_delivered_count INTEGER DEFAULT 0 NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PUBLISH FUNCTION
-- ============================================================================
-- Called by developer triggers to publish events (system messages)

CREATE OR REPLACE FUNCTION insforge_realtime.publish(
  p_channel_name TEXT,
  p_event_name TEXT,
  p_payload JSONB
) RETURNS UUID AS $$
DECLARE
  v_channel_id UUID;
  v_message_id UUID;
BEGIN
  -- Find matching channel (exact match or wildcard pattern)
  SELECT id INTO v_channel_id
  FROM insforge_realtime.channels
  WHERE enabled = TRUE
    AND (name = p_channel_name OR p_channel_name LIKE name)
  ORDER BY name = p_channel_name DESC
  LIMIT 1;

  IF v_channel_id IS NULL THEN
    RAISE WARNING 'Realtime: No matching channel found for "%"', p_channel_name;
    RETURN NULL;
  END IF;

  -- Insert message (sender_type = 'system')
  INSERT INTO insforge_realtime.messages (
    event_name, channel_id, channel_name, payload, sender_type
  ) VALUES (
    p_event_name, v_channel_id, p_channel_name, p_payload, 'system'
  ) RETURNING id INTO v_message_id;

  -- Notify RealtimeManager
  PERFORM pg_notify('insforge_realtime', jsonb_build_object(
    'message_id', v_message_id,
    'channel_id', v_channel_id,
    'channel_name', p_channel_name,
    'event_name', p_event_name,
    'payload', p_payload
  )::text);

  RETURN v_message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Example: Developer Trigger

```sql
CREATE OR REPLACE FUNCTION notify_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM insforge_realtime.publish(
      'order:' || NEW.id::text,
      'status_changed',
      jsonb_build_object(
        'order_id', NEW.id,
        'old_status', OLD.status,
        'new_status', NEW.status
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_status_realtime
AFTER UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION notify_order_status_change();
```

### Example: RLS Policies

```sql
-- Allow authenticated users to subscribe to public channels
CREATE POLICY "authenticated_subscribe_public" ON insforge_realtime.messages
  FOR SELECT USING (
    current_setting('request.jwt.claim.role', true) = 'authenticated'
    AND channel_name = current_setting('realtime.channel_name', true)
  );

-- Allow users to publish to their own channels
CREATE POLICY "user_publish_own_channel" ON insforge_realtime.messages
  FOR INSERT WITH CHECK (
    channel_name LIKE 'user:' || current_setting('request.jwt.claim.sub', true) || ':%'
  );
```

---

## Backend Implementation

### File Structure

```
backend/src/
├── infra/
│   ├── database/
│   │   └── database.manager.ts      # createClient() for dedicated LISTEN connection
│   ├── realtime/
│   │   ├── realtime.manager.ts      # Listens to pg_notify, handles broadcasts
│   │   └── webhook-sender.ts        # HTTP client for webhook delivery
│   └── socket/
│       └── socket.manager.ts        # Subscribe/unsubscribe/publish handlers
├── services/
│   └── realtime/
│       ├── index.ts                 # Barrel export
│       ├── realtime-auth.service.ts # Permission checks via RLS
│       ├── realtime-channel.service.ts # Channel CRUD + getByName()
│       └── realtime-message.service.ts # Message insert + stats
├── api/
│   └── routes/
│       └── realtime/
│           ├── index.routes.ts      # Router
│           ├── channels.routes.ts   # Channel CRUD endpoints
│           └── messages.routes.ts   # Message list + stats endpoints
└── types/
    ├── realtime.ts                  # Re-exports shared types + backend-only types
    └── socket.ts                    # Socket events enum
```

### Shared Schemas (`shared-schemas/src/`)

Types shared between backend, frontend, and SDK:

```typescript
// realtime.schema.ts
export type SenderType = 'system' | 'user';

export interface RealtimeChannel {
  id: string;
  name: string;
  description: string | null;
  webhookUrls: string[] | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RealtimeMessage {
  id: string;
  eventName: string;
  channelId: string | null;
  channelName: string;
  payload: Record<string, unknown>;
  senderType: SenderType;
  senderId: string | null;
  wsAudienceCount: number;
  whAudienceCount: number;
  whDeliveredCount: number;
  createdAt: string;
}

// WebSocket payloads
export interface SubscribeChannelPayload { channel: string; }
export interface PublishEventPayload { channel: string; event: string; payload: Record<string, unknown>; }
export interface SubscribedChannelPayload { channel: string; }
export interface UnsubscribedChannelPayload { channel: string; }
export interface RealtimeErrorPayload { channel?: string; code: string; message: string; }
export interface WebhookEventPayload { messageId: string; channel: string; eventName: string; payload: Record<string, unknown>; }

// realtime-api.schema.ts
export interface CreateChannelRequest { name: string; description?: string; webhookUrls?: string[]; enabled?: boolean; }
export interface UpdateChannelRequest { name?: string; description?: string; webhookUrls?: string[]; enabled?: boolean; }
// ... more API types
```

### Backend-Only Types

```typescript
// backend/src/types/realtime.ts

// Re-exported from shared-schemas
export type { RealtimeChannel, RealtimeMessage, SubscribeChannelPayload, ... } from '@insforge/shared-schemas';

// Backend-only types
export interface RealtimeEvent {
  message_id: string;
  channel_id: string;
  channel_name: string;
  event_name: string;
  payload: Record<string, unknown>;
}

export interface DeliveryResult {
  wsAudienceCount: number;
  whAudienceCount: number;
  whDeliveredCount: number;
}
```

### Socket Events

```typescript
// ServerEvents (Server → Client)
enum ServerEvents {
  REALTIME_SUBSCRIBED = 'realtime:subscribed',
  REALTIME_UNSUBSCRIBED = 'realtime:unsubscribed',
  REALTIME_ERROR = 'realtime:error',
}

// ClientEvents (Client → Server)
enum ClientEvents {
  REALTIME_SUBSCRIBE = 'realtime:subscribe',
  REALTIME_UNSUBSCRIBE = 'realtime:unsubscribe',
  REALTIME_PUBLISH = 'realtime:publish',
}
```

---

## API Routes

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/realtime/channels` | List all channels | Admin |
| GET | `/api/realtime/channels/:id` | Get channel details | Admin |
| POST | `/api/realtime/channels` | Create a channel | Admin |
| PUT | `/api/realtime/channels/:id` | Update a channel | Admin |
| DELETE | `/api/realtime/channels/:id` | Delete a channel | Admin |
| GET | `/api/realtime/messages` | List messages | Admin |
| GET | `/api/realtime/messages/stats` | Get message statistics | Admin |

---

## WebSocket Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `realtime:subscribe` | `{ channel: string }` | Subscribe to a channel (e.g., "order:123") |
| `realtime:unsubscribe` | `{ channel: string }` | Unsubscribe from a channel |
| `realtime:publish` | `{ channel, event, payload }` | Publish a message (requires subscription) |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `<event_name>` | `{ messageId, ...payload, timestamp }` | Custom event (event name from message) |
| `realtime:subscribed` | `{ channel }` | Successfully subscribed |
| `realtime:unsubscribed` | `{ channel }` | Successfully unsubscribed |
| `realtime:error` | `{ channel?, code, message }` | Error (UNAUTHORIZED, NOT_SUBSCRIBED, etc.) |

---

## Usage Examples

### 1. Create a Channel

```bash
curl -X POST http://localhost:7130/api/realtime/channels \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "order:%",
    "description": "Real-time updates for individual orders",
    "webhookUrls": ["https://example.com/webhooks/orders"]
  }'
```

### 2. Subscribe and Listen (Client)

```javascript
// Subscribe to channel
socket.emit('realtime:subscribe', { channel: 'order:123' });

// Handle subscription confirmation
socket.on('realtime:subscribed', ({ channel }) => {
  console.log(`Subscribed to ${channel}`);
});

// Listen for events
socket.on('status_changed', (data) => {
  console.log('Order status changed:', data.payload);
});
```

### 3. Publish from Client

```javascript
// Must be subscribed first
socket.emit('realtime:publish', {
  channel: 'chat:room-1',
  event: 'message',
  payload: { text: 'Hello world!', userId: '123' }
});
```

---

## Implementation Status

### Phase 1: Core Infrastructure ✅

- [x] Database migration (`017_create-realtime-schema.sql`)
  - Schema, channels table, messages table
  - `publish(channel, event, payload)` function
  - RLS policies for admin access
- [x] RealtimeManager (`backend/src/infra/realtime/realtime.manager.ts`)
  - pg_notify listener with reconnection logic
  - WebSocket broadcast via SocketManager
  - Client message handling via `broadcastClientMessage()`
- [x] WebhookSender (`backend/src/infra/realtime/webhook-sender.ts`)
  - Retry logic (2 retries with backoff)
  - Custom headers for event metadata
- [x] DatabaseManager extension (`createClient()` factory method)
- [x] SocketManager extensions
  - `getRoomSize()`, `broadcastToRoom()`
  - Subscribe/unsubscribe/publish handlers

### Phase 2: Services & API ✅

- [x] RealtimeChannelService (CRUD + `getByName()` with wildcard matching)
- [x] RealtimeAuthService (`checkSubscribePermission()` via RLS)
- [x] RealtimeMessageService (`insertMessage()`, `updateDeliveryStats()`, `list()`, `getStats()`)
- [x] API routes (channels, messages)
- [x] Server initialization and graceful shutdown
- [x] Shared schemas (`@insforge/shared-schemas`)

### Phase 3: Testing 🔲

- [ ] Unit tests for services
- [ ] Integration tests for WebSocket events
- [ ] Webhook delivery tests
- [ ] RLS policy testing

---

## Potential Issues & Mitigations

| Issue | Impact | Mitigation |
|-------|--------|------------|
| `pg_notify` 8KB payload limit | Large payloads fail | Use selected fields or reference IDs only |
| Events lost if no listeners | Data loss during disconnects | Messages table provides audit trail |
| Single listener connection | Bottleneck | Reconnection with exponential backoff |
| Webhook delivery failures | Missed notifications | Retry logic; message table tracks failures |
