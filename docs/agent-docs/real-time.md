# InsForge Realtime - Agent Documentation

## Use Realtime For

- Live client updates from database changes.
- Client-to-client broadcasts on named channels.
- Ephemeral presence on subscribed channels.
- Webhook fan-out for messages published to a channel.

Realtime delivers events to subscribed clients and configured webhook URLs. If server-side code must perform work after a database change, such as sending email, writing another table, or calling an API, put that work in an Edge Function and invoke it from a database trigger.

## Mental Model

1. Create channel patterns in `realtime.channels`.
2. Publish messages into `realtime.messages`.
3. Postgres triggers `pg_notify('realtime_message', message_id)`.
4. The backend loads the message, checks the channel is enabled, and delivers it to Socket.IO subscribers plus channel webhooks.
5. Delivery stats are written back to the message row.

Channel patterns use SQL `LIKE`: `order:%` matches `order:123`. Use `:` as the separator and `%` as the wildcard. Do not use `_`.

## Backend Setup

### 1. Create Channel Patterns

```sql
INSERT INTO realtime.channels (pattern, description, enabled)
VALUES
  ('orders', 'Global order events', true),
  ('order:%', 'Per-order events', true),
  ('chat:%', 'Chat room events', true);
```

You can also create channels in the Dashboard Realtime page.

### 2. Publish Database Changes

Create a trigger on the app table you want to watch. In the trigger function, call `realtime.publish(channel, event, payload)` to choose the channel, event name, and payload.

```sql
CREATE OR REPLACE FUNCTION notify_order_status()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM realtime.publish(
    'order:' || NEW.id::text,
    'status_changed',
    jsonb_build_object(
      'id', NEW.id,
      'status', NEW.status,
      'updatedAt', NEW.updated_at
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER order_status_realtime
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION notify_order_status();
```

For delete events, use `OLD` instead of `NEW`.

### 3. Add Access Control When Needed

Realtime is open by default. `anon` and `authenticated` can subscribe to enabled channels and publish to channels they joined.

To restrict access:

```sql
ALTER TABLE realtime.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
```

Subscribe is controlled by `SELECT` policies on `realtime.channels`:

```sql
CREATE POLICY "users_subscribe_own_orders"
ON realtime.channels
FOR SELECT
TO authenticated
USING (
  pattern = 'order:%'
  AND EXISTS (
    SELECT 1
    FROM orders
    WHERE id = NULLIF(split_part(realtime.channel_name(), ':', 2), '')::uuid
      AND user_id = auth.uid()
  )
);
```

Publish is controlled by `INSERT` policies on `realtime.messages`:

```sql
CREATE POLICY "members_publish_chat"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  channel_name LIKE 'chat:%'
  AND EXISTS (
    SELECT 1
    FROM chat_members
    WHERE room_id = NULLIF(split_part(channel_name, ':', 2), '')::uuid
      AND user_id = auth.uid()
  )
);
```

Use `realtime.channel_name()` in subscribe policies because `realtime.channels` stores patterns, while the client requests a resolved channel such as `order:123`.

## Frontend SDK Pattern

```typescript
import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://your-project.insforge.app',
  anonKey: 'your-anon-key'
});

insforge.realtime.on('error', ({ channel, code, message }) => {
  console.error(channel, code, message);
});

await insforge.realtime.connect();

const response = await insforge.realtime.subscribe(`order:${orderId}`);

if (!response.ok) {
  throw new Error(response.error.message);
}

insforge.realtime.on('status_changed', (payload) => {
  console.log(payload.status);
  console.log(payload.meta.messageId);
});
```

### SDK Methods

| Task | Method |
|------|--------|
| Connect | `await insforge.realtime.connect()` |
| Subscribe | `await insforge.realtime.subscribe(channel)` |
| Publish | `await insforge.realtime.publish(channel, event, payload)` |
| Listen | `insforge.realtime.on(event, callback)` |
| Listen once | `insforge.realtime.once(event, callback)` |
| Remove listener | `insforge.realtime.off(event, callback)` |
| Unsubscribe | `insforge.realtime.unsubscribe(channel)` |
| Disconnect | `insforge.realtime.disconnect()` |
| List local subscriptions | `insforge.realtime.getSubscribedChannels()` |

Client publish requires a successful subscription to the same channel first.

## Raw Socket.IO Contract

Use this only when the SDK is not available.

```typescript
import { io } from 'socket.io-client';

const socket = io('https://your-project.insforge.app', {
  auth: {
    token: '<user-jwt-or-anon-token>'
  }
});

socket.emit('realtime:subscribe', { channel: 'chat:room-1' }, (response) => {
  if (!response.ok) {
    console.error(response.error);
  }
});

socket.on('new_message', (message) => {
  console.log(message);
});

socket.emit('realtime:publish', {
  channel: 'chat:room-1',
  event: 'new_message',
  payload: { text: 'Hello' }
});
```

Events:

| Event | Direction |
|-------|-----------|
| `realtime:subscribe` | Client to server |
| `realtime:unsubscribe` | Client to server |
| `realtime:publish` | Client to server |
| Custom event name | Server to client |
| `presence:join` | Server to client |
| `presence:leave` | Server to client |
| `realtime:error` | Server to client |

## Presence

`subscribe()` returns:

```json
{
  "ok": true,
  "channel": "chat:room-1",
  "presence": {
    "members": [
      {
        "type": "user",
        "presenceId": "user-id",
        "joinedAt": "2026-04-25T17:00:00.000Z"
      }
    ]
  }
}
```

Listen for `presence:join` and `presence:leave` to keep local online state current. Presence is in-memory online state, not durable membership.

## Webhooks

Channel `webhookUrls` receive the message payload as the request body.

Headers:

| Header | Meaning |
|--------|---------|
| `X-InsForge-Event` | Event name |
| `X-InsForge-Channel` | Resolved channel name |
| `X-InsForge-Message-Id` | Message UUID |

Webhook delivery counts appear in message history as `whAudienceCount` and `whDeliveredCount`.

## Message Retention

`realtime.config.retention_days` controls cleanup:

- `NULL`: keep messages indefinitely.
- Positive integer: delete messages older than that many days.

The cleanup job runs daily through pg_cron.

## Dashboard And REST Checks

Use Dashboard Realtime pages to verify:

- Channels: patterns, enabled state, webhooks.
- Messages: payloads, sender type, WebSocket audience, webhook delivery.
- Permissions: RLS policies for subscribe and publish.
- Settings: message retention.

REST endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/realtime/channels` | List channels |
| `POST /api/realtime/channels` | Create channel |
| `PUT /api/realtime/channels/{id}` | Update channel |
| `DELETE /api/realtime/channels/{id}` | Delete channel |
| `GET /api/realtime/messages` | List message history |
| `GET /api/realtime/messages/stats` | Message stats |
| `GET /api/realtime/permissions` | Realtime RLS policies |
| `GET /api/realtime/config` | Retention config |
| `PATCH /api/realtime/config` | Update retention config |
