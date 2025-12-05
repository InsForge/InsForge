# InsForge Realtime - Agent Documentation

## Overview

InsForge Realtime enables real-time pub/sub messaging via WebSockets:
- **Database events**: Emit events when data changes using triggers
- **Client events**: Clients can publish custom events to each other

## Backend Setup (Raw SQL)

### Step 1: Create Channel Patterns

Define which channels are available:

```sql
INSERT INTO realtime.channels (pattern, description, enabled)
VALUES
  ('orders', 'Global order events', true),
  ('order:%', 'Order-specific events (order:123, order:456)', true),
  ('chat:%', 'Chat room events', true);
```

**Pattern syntax**: Use `:` as separator, `%` as wildcard (SQL LIKE pattern).

### Step 2: Create Triggers for Database Events

**IMPORTANT**: To emit events when database rows change, create a trigger that calls `realtime.publish()`:

```sql
-- Step 2a: Create the trigger function
CREATE OR REPLACE FUNCTION notify_order_changes()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM realtime.publish(
    'order:' || NEW.id::text,    -- channel name
    TG_OP || '_order',           -- event name: INSERT_order, UPDATE_order, DELETE_order
    jsonb_build_object(          -- payload (what clients receive)
      'id', NEW.id,
      'status', NEW.status,
      'total', NEW.total
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 2b: Attach trigger to table
CREATE TRIGGER order_realtime
  AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION notify_order_changes();
```

### Step 3: Add Access Control (Optional)

By default, all authenticated users can subscribe to any channel. To restrict access, add RLS policies:

#### Restrict who can subscribe (SELECT on realtime.channels)

```sql
-- Only order owner can subscribe to their order channel
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

**Note**: Use `realtime.channel_name()` in subscribe policies to get the actual channel (e.g., `order:123`) since the table only stores patterns (e.g., `order:%`).

#### Restrict who can publish from client (INSERT on realtime.messages)

```sql
-- Only chat room members can publish messages
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

## Frontend SDK

### Setup

```typescript
import { createClient } from '@insforge/sdk'

const insforge = createClient({
  baseUrl: 'https://your-project.insforge.app'
})
```

### Core Methods

#### connect() - Establish WebSocket connection

```typescript
await insforge.realtime.connect()
```

#### subscribe(channel) - Subscribe to a channel

```typescript
const { ok, error } = await insforge.realtime.subscribe('order:123')
if (!ok) console.error('Failed:', error?.message)
```

#### on(event, callback) - Listen for events

```typescript
// Listen for database-triggered events
insforge.realtime.on('INSERT_order', (payload) => {
  console.log('New order:', payload.id, payload.status)
})

insforge.realtime.on('UPDATE_order', (payload) => {
  console.log('Order updated:', payload)
})
```

#### publish(channel, event, payload) - Send client events

```typescript
// Must be subscribed to channel first
await insforge.realtime.publish('chat:room-1', 'new_message', {
  text: 'Hello!',
  sender: 'Alice'
})
```

#### unsubscribe(channel)

```typescript
insforge.realtime.unsubscribe('order:123')
```

#### off(event, callback) - Remove listener

```typescript
insforge.realtime.off('UPDATE_order', handler)
```

#### disconnect() - Close connection

```typescript
insforge.realtime.disconnect()
```

### Connection Events

```typescript
insforge.realtime.on('connect', () => console.log('Connected'))
insforge.realtime.on('disconnect', (reason) => console.log('Disconnected:', reason))
insforge.realtime.on('connect_error', (err) => console.error('Connection failed:', err))
insforge.realtime.on('error', ({ code, message }) => console.error('Error:', code, message))
```

**Error codes**: `UNAUTHORIZED`, `NOT_SUBSCRIBED`, `INTERNAL_ERROR`

### Properties

```typescript
insforge.realtime.isConnected           // boolean
insforge.realtime.connectionState       // 'disconnected' | 'connecting' | 'connected'
insforge.realtime.socketId              // string (when connected)
insforge.realtime.getSubscribedChannels() // string[]
```

### Message Metadata

All received messages include a `meta` field:

```typescript
insforge.realtime.on('UPDATE_order', (payload) => {
  console.log(payload.meta.messageId)   // UUID
  console.log(payload.meta.channel)     // 'order:123'
  console.log(payload.meta.senderType)  // 'system' (trigger) or 'user' (client)
  console.log(payload.meta.timestamp)   // Date

  // Your payload fields
  console.log(payload.status)
})
```

## Complete Examples

### Database Events (Order Status Updates)

**Backend SQL:**
```sql
-- 1. Create channel
INSERT INTO realtime.channels (pattern, description, enabled)
VALUES ('order:%', 'Order updates', true);

-- 2. Create trigger
CREATE OR REPLACE FUNCTION notify_order_status()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM realtime.publish(
    'order:' || NEW.id::text,
    'status_changed',
    jsonb_build_object('id', NEW.id, 'status', NEW.status, 'updated_at', NEW.updated_at)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER order_status_trigger
  AFTER UPDATE ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION notify_order_status();
```

**Frontend:**
```typescript
await insforge.realtime.connect()
await insforge.realtime.subscribe(`order:${orderId}`)

insforge.realtime.on('status_changed', (payload) => {
  updateUI(payload.status)
})
```

### Client Events (Chat Room)

**Backend SQL:**
```sql
INSERT INTO realtime.channels (pattern, description, enabled)
VALUES ('chat:%', 'Chat rooms', true);
```

**Frontend:**
```typescript
await insforge.realtime.connect()
await insforge.realtime.subscribe('chat:room-1')

// Listen for messages from other users
insforge.realtime.on('message', (payload) => {
  addMessage(payload.text, payload.sender)
})

// Send a message
async function sendMessage(text: string) {
  await insforge.realtime.publish('chat:room-1', 'message', {
    text,
    sender: currentUser.name
  })
}
```

### React Hook

```typescript
import { useEffect, useCallback, useRef, useState } from 'react'
import { insforge } from './lib/insforge'

export function useRealtime(channel: string, handlers: Record<string, (payload: any) => void>) {
  // Use ref to always have latest handlers without re-running effect
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    let mounted = true

    async function setup() {
      await insforge.realtime.connect()
      const { ok } = await insforge.realtime.subscribe(channel)
      if (!ok || !mounted) return

      Object.entries(handlersRef.current).forEach(([event, handler]) => {
        insforge.realtime.on(event, handler)
      })
    }

    setup()

    return () => {
      mounted = false
      Object.entries(handlersRef.current).forEach(([event, handler]) => {
        insforge.realtime.off(event, handler)
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
function OrderTracker({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState('')

  useRealtime(`order:${orderId}`, {
    status_changed: (p) => setStatus(p.status)
  })

  return <div>Order Status: {status}</div>
}
```

## Quick Reference

| Task | How |
|------|-----|
| Emit event on DB change | Create trigger calling `realtime.publish(channel, event, payload)` |
| Client sends event | `insforge.realtime.publish(channel, event, payload)` |
| Listen for events | `insforge.realtime.on(eventName, callback)` |
| Restrict subscribe access | RLS SELECT policy on `realtime.channels` |
| Restrict client publish | RLS INSERT policy on `realtime.messages` |
