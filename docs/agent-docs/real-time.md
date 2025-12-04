# InsForge Realtime - Agent Documentation

## Overview

InsForge Realtime provides event-driven messaging via PostgreSQL triggers � WebSockets (Socket.IO). Events are controlled by RLS policies on two tables:
- `realtime.channels` - SELECT policy controls **subscribe** access
- `realtime.messages` - INSERT policy controls **publish** access

## Backend Configuration (Raw SQL)

### 1. Create Channel Patterns

```sql
INSERT INTO realtime.channels (pattern, description, webhook_urls, enabled)
VALUES
  ('orders', 'Global order events', NULL, true),
  ('order:%', 'Order-specific events (order:123)', NULL, true),
  ('chat:%', 'Chat room events', ARRAY['https://hooks.example.com/chat'], true);
```

**Pattern syntax**: Use `:` as separator, `%` for wildcards (SQL LIKE). `order:%` matches `order:123`, `order:456`, etc.

### 2. Configure RLS Policies

#### Subscribe Policies (SELECT on realtime.channels)

Use `realtime.channel_name()` to access the requested channel name:

```sql
-- Public channel: anyone can subscribe
CREATE POLICY "public_subscribe_orders"
ON realtime.channels FOR SELECT
TO authenticated
USING (pattern = 'orders');

-- User-specific: only owner can subscribe to their order channel
CREATE POLICY "users_subscribe_own_orders"
ON realtime.channels FOR SELECT
TO authenticated
USING (
  pattern = 'order:%'
  AND EXISTS (
    SELECT 1 FROM orders
    WHERE id = NULLIF(split_part(realtime.channel_name(), ':', 2), '')::uuid
      AND user_id = auth.uid()
  )
);
```

#### Publish Policies (INSERT on realtime.messages)

```sql
-- Only admins can publish to order channels
CREATE POLICY "admins_publish_orders"
ON realtime.messages FOR INSERT
TO authenticated
WITH CHECK (
  channel_name LIKE 'order:%'
  AND EXISTS (SELECT 1 FROM admins WHERE user_id = auth.uid())
);

-- Users can publish to chat rooms they're members of
CREATE POLICY "members_publish_chat"
ON realtime.messages FOR INSERT
TO authenticated
WITH CHECK (
  channel_name LIKE 'chat:%'
  AND EXISTS (
    SELECT 1 FROM chat_members
    WHERE room_id = NULLIF(split_part(channel_name, ':', 2), '')::uuid
      AND user_id = auth.uid()
  )
);
```

### 3. Create Database Triggers

Use `realtime.publish(channel, event, payload)` to emit events from triggers:

```sql
CREATE OR REPLACE FUNCTION notify_order_changes()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM realtime.publish(
    'order:' || NEW.id::text,           -- channel name
    TG_OP || '_order',                   -- event: INSERT_order, UPDATE_order, DELETE_order
    jsonb_build_object(
      'id', NEW.id,
      'status', NEW.status,
      'total', NEW.total
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER order_realtime
  AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION notify_order_changes();
```

**Note**: `realtime.publish()` bypasses RLS (SECURITY DEFINER) - only callable from triggers.

## Frontend SDK Integration

### Installation

```bash
npm install @insforge/sdk
```

### Initialize Client

```typescript
import { createClient } from '@insforge/sdk'

const insforge = createClient({
  baseUrl: 'https://your-project.insforge.app'
})
```

### SDK Methods

#### connect()

```typescript
await insforge.realtime.connect()
// Auth token automatically included from logged-in user
```

#### subscribe(channel)

```typescript
const response = await insforge.realtime.subscribe('order:123')
// Returns: { ok: boolean, channel: string, error?: { code: string, message: string } }

if (!response.ok) {
  console.error('Subscription failed:', response.error?.message)
}
```

#### unsubscribe(channel)

```typescript
insforge.realtime.unsubscribe('order:123')  // Fire-and-forget
```

#### publish(channel, event, payload)

**Requirement**: Must be subscribed to channel before publishing.

```typescript
await insforge.realtime.publish('chat:room-1', 'new_message', {
  text: 'Hello!',
  sender: 'Alice'
})
```

#### on(event, callback)

```typescript
// Custom events
insforge.realtime.on('INSERT_order', (payload) => {
  console.log('New order:', payload)
})

// With TypeScript generics
insforge.realtime.on<MyPayloadType>('my_event', (payload) => {
  // payload is typed as MyPayloadType
})
```

**Reserved events**:
| Event | Payload | Description |
|-------|---------|-------------|
| `connect` | - | Connected to server |
| `connect_error` | `Error` | Connection failed |
| `disconnect` | `string` (reason) | Disconnected |
| `error` | `{ code, message }` | Realtime error |

**Error codes**: `UNAUTHORIZED`, `NOT_SUBSCRIBED`, `INTERNAL_ERROR`

#### off(event, callback)

```typescript
const handler = (payload) => console.log(payload)
insforge.realtime.on('my_event', handler)
insforge.realtime.off('my_event', handler)  // Must pass same function reference
```

#### disconnect()

```typescript
insforge.realtime.disconnect()  // Clears all subscriptions
```

### Properties

```typescript
insforge.realtime.isConnected        // boolean
insforge.realtime.connectionState    // 'disconnected' | 'connecting' | 'connected'
insforge.realtime.socketId           // string (when connected)
insforge.realtime.getSubscribedChannels()  // string[]
```

### Message Structure

All messages include server-enforced `meta`:

```typescript
interface SocketMessage {
  meta: {
    channel?: string           // Channel name
    messageId: string          // UUID
    senderType: 'system' | 'user'  // 'system' = trigger, 'user' = client
    senderId?: string          // User UUID (for user messages)
    timestamp: Date
  }
  // ...custom payload fields
}
```

### Complete Example

```typescript
import { createClient } from '@insforge/sdk'

const insforge = createClient({ baseUrl: 'https://your-project.insforge.app' })

// Error handling
insforge.realtime.on('error', (err) => console.error('RT Error:', err.code, err.message))
insforge.realtime.on('disconnect', (reason) => console.log('Disconnected:', reason))

// Connect and subscribe
await insforge.realtime.connect()
const { ok } = await insforge.realtime.subscribe('order:123')

if (ok) {
  // Listen for events
  insforge.realtime.on('UPDATE_order', (payload) => {
    console.log('Order updated:', payload.status)
    console.log('Message ID:', payload.meta.messageId)
  })
}

// Cleanup
function cleanup() {
  insforge.realtime.unsubscribe('order:123')
  insforge.realtime.disconnect()
}
```

### React Hook Example

```typescript
import { useEffect, useCallback } from 'react'
import { insforge } from './lib/insforge'

export function useRealtime(channel: string, handlers: Record<string, Function>) {
  useEffect(() => {
    let mounted = true

    async function setup() {
      await insforge.realtime.connect()
      const { ok } = await insforge.realtime.subscribe(channel)
      if (!ok || !mounted) return

      Object.entries(handlers).forEach(([event, handler]) => {
        insforge.realtime.on(event, handler as any)
      })
    }

    setup()

    return () => {
      mounted = false
      Object.entries(handlers).forEach(([event, handler]) => {
        insforge.realtime.off(event, handler as any)
      })
      insforge.realtime.unsubscribe(channel)
    }
  }, [channel])

  const publish = useCallback(
    (event: string, payload: object) => insforge.realtime.publish(channel, event, payload),
    [channel]
  )

  return { publish }
}

// Usage
function OrderStatus({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState('')

  useRealtime(`order:${orderId}`, {
    UPDATE_order: (payload) => setStatus(payload.status)
  })

  return <div>Status: {status}</div>
}
```

## Database Schema Reference

### realtime.channels

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| pattern | TEXT | Channel pattern (`orders`, `order:%`) |
| description | TEXT | Human-readable description |
| webhook_urls | TEXT[] | Webhook endpoints (optional) |
| enabled | BOOLEAN | Active status |

### realtime.messages

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| event_name | TEXT | Event type |
| channel_id | UUID | FK to channels |
| channel_name | TEXT | Resolved channel name |
| payload | JSONB | Event data |
| sender_type | TEXT | `system` or `user` |
| sender_id | UUID | User ID (for user messages) |
| ws_audience_count | INTEGER | WebSocket subscribers at delivery |
| wh_audience_count | INTEGER | Webhook URLs configured |
| wh_delivered_count | INTEGER | Successful webhook deliveries |

## Webhook Delivery

When `webhook_urls` configured on channel, messages are POSTed:

```http
POST /webhook-endpoint HTTP/1.1
Content-Type: application/json
X-InsForge-Event: order_created
X-InsForge-Channel: order:123
X-InsForge-Message-Id: uuid

{ ...payload }
```

- **Retries**: 2 retries (1s, 2s backoff)
- **Timeout**: 10s per request

## Key Points

1. **RLS controls access**: Subscribe = SELECT on channels, Publish = INSERT on messages
2. **Channel patterns**: Use `%` wildcard, `:` separator
3. **Helper function**: `realtime.channel_name()` returns requested channel in policies
4. **Sender types**: `system` (triggers, bypasses RLS) vs `user` (client SDK, respects RLS)
5. **Must subscribe before publish**: Client must subscribe to channel first
6. **No message replay**: Missed messages during disconnect are not resent
7. **Auto reconnection**: Socket.IO handles reconnection automatically
