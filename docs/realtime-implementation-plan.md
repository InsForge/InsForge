# Realtime Feature Implementation Plan

## Overview

InsForge needs a realtime feature that allows developers to:
1. Define channels with authentication policies for join/send permissions via RLS
2. Send events to channels via a predefined function from custom triggers
3. Deliver events to WebSocket clients and/or webhook URLs
4. Track usage and delivery statistics

---

## Architecture Design

### Schema: `insforge_realtime`

All realtime-related system tables live in a dedicated schema.

### Tables

| Table | Purpose |
|-------|---------|
| `insforge_realtime.channels` | Channel definitions with auth policies (RLS) and delivery config |
| `insforge_realtime.usage` | Audit log of all events with delivery statistics |

### Event Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DEVELOPER'S TABLE TRIGGER                            │
│                    (Custom condition, payload, channel)                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Calls insforge_realtime.send(channel, event, payload)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      insforge_realtime.send()                                │
│  1. Insert record into usage table (get message_id)                         │
│  2. pg_notify('insforge_realtime', {message_id, channel_id, channel_name,   │
│     event_name, payload})                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ LISTEN 'insforge_realtime'
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REALTIME MANAGER                                   │
│  1. Lookup channel config (exists? enabled? webhook urls?)                  │
│  2. Emit to WebSocket: broadcast to Socket.IO room                          │
│  3. Emit to Webhooks: POST to each configured URL                           │
│  4. Update usage record with delivery counts                                │
└─────────────────────────────────────────────────────────────────────────────┘
                          │                           │
                          ▼                           ▼
              ┌─────────────────────┐     ┌─────────────────────┐
              │  WebSocket Clients  │     │   Webhook Endpoints │
              └─────────────────────┘     └─────────────────────┘
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Schema | `insforge_realtime` | Isolate realtime tables from user tables |
| Event creation | Developer triggers | Full control over condition, payload, channel |
| Delivery | WebSocket + Webhooks | Flexibility for different use cases |
| Auth | RLS on channels table | Developers write custom SQL policies |
| Audit | Usage table | Track all events and delivery stats |
| Wildcard syntax | `%` (LIKE pattern) | Native PostgreSQL, less error-prone than `{param}` |
| Function params | `(channel, event, payload)` | More natural order |
| WS delivery tracking | Audience count only | Socket.IO doesn't provide delivery confirmation |

---

## Database Schema

### Migration: `017_create-realtime-schema.sql`

```sql
-- Migration 017: Create Realtime Schema
--
-- Creates the insforge_realtime schema with:
-- 1. channels table - Channel definitions with webhook configuration
-- 2. usage table - Audit log of all events with delivery statistics
-- 3. send() function - Called by developer triggers to send events

-- ============================================================================
-- CREATE SCHEMA
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS insforge_realtime;

-- ============================================================================
-- CHANNELS TABLE
-- ============================================================================
-- Stores channel definitions with delivery configuration.
-- RLS policies control join/send permissions.
-- Channel names use : as separator and % for wildcards (LIKE pattern).
-- Examples: "orders", "order:%", "chat:%:messages"

CREATE TABLE IF NOT EXISTS insforge_realtime.channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Channel name pattern (e.g., "orders", "order:%", "chat:%:messages")
  -- Convention: use : as separator, % for wildcards (LIKE pattern)
  name TEXT UNIQUE NOT NULL,

  -- Human-readable description
  description TEXT,

  -- Webhook URLs to POST events to (NULL or empty array = no webhooks)
  webhook_urls TEXT[],

  -- Whether this channel is active
  enabled BOOLEAN DEFAULT TRUE NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- USAGE TABLE (Audit Log)
-- ============================================================================
-- Tracks all events sent through the realtime system.
-- All events here are system-triggered (from database triggers).

CREATE TABLE IF NOT EXISTS insforge_realtime.usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Event metadata
  event_name TEXT NOT NULL,

  -- Channel reference (SET NULL on delete to preserve history)
  channel_id UUID REFERENCES insforge_realtime.channels(id) ON DELETE SET NULL,
  channel_name TEXT NOT NULL, -- Denormalized for query convenience after channel deletion

  -- Delivery statistics for WebSocket
  ws_audience_count INTEGER DEFAULT 0 NOT NULL, -- How many clients were subscribed

  -- Delivery statistics for Webhooks
  wh_audience_count INTEGER DEFAULT 0 NOT NULL, -- How many webhook URLs configured
  wh_delivered_count INTEGER DEFAULT 0 NOT NULL, -- How many succeeded (2xx response)

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_realtime_channels_name ON insforge_realtime.channels(name);
CREATE INDEX IF NOT EXISTS idx_realtime_channels_enabled ON insforge_realtime.channels(enabled);
CREATE INDEX IF NOT EXISTS idx_realtime_usage_channel_id ON insforge_realtime.usage(channel_id);
CREATE INDEX IF NOT EXISTS idx_realtime_usage_created_at ON insforge_realtime.usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_realtime_usage_event_name ON insforge_realtime.usage(event_name);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION insforge_realtime.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_channels_updated_at ON insforge_realtime.channels;
CREATE TRIGGER trg_channels_updated_at
BEFORE UPDATE ON insforge_realtime.channels
FOR EACH ROW EXECUTE FUNCTION insforge_realtime.update_updated_at();

-- ============================================================================
-- ENABLE RLS
-- ============================================================================

ALTER TABLE insforge_realtime.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE insforge_realtime.usage ENABLE ROW LEVEL SECURITY;

-- Admin can manage all channels
CREATE POLICY "admin_full_access_channels" ON insforge_realtime.channels
  FOR ALL USING (
    current_setting('request.jwt.claim.role', true) = 'project_admin'
  );

-- Admin can view all usage records
CREATE POLICY "admin_read_usage" ON insforge_realtime.usage
  FOR SELECT USING (
    current_setting('request.jwt.claim.role', true) = 'project_admin'
  );
```

### Send Function (included in `017_create-realtime-schema.sql`)

```sql
-- ============================================================================
-- SEND FUNCTION
-- ============================================================================
-- Called by developer triggers to send events to channels.
-- This function can only be executed by the backend (SECURITY DEFINER).
--
-- Usage in a trigger:
--   PERFORM insforge_realtime.send(
--     'order:' || NEW.id::text,  -- channel name (resolved instance)
--     'order_updated',           -- event name
--     jsonb_build_object('id', NEW.id, 'status', NEW.status)  -- payload
--   );

CREATE OR REPLACE FUNCTION insforge_realtime.send(
  p_channel_name TEXT,
  p_event_name TEXT,
  p_payload JSONB
)
RETURNS UUID AS $$
DECLARE
  v_channel_id UUID;
  v_message_id UUID;
BEGIN
  -- Channel name convention: segments separated by ':'
  -- Wildcard segments use % syntax (LIKE pattern), e.g., "order:%"

  -- First, try exact match (no wildcards in pattern)
  SELECT id INTO v_channel_id
  FROM insforge_realtime.channels
  WHERE name = p_channel_name AND enabled = TRUE
  LIMIT 1;

  -- If no exact match, try pattern matching for wildcards
  -- Channel patterns use % for wildcards, e.g., "order:%" matches "order:123"
  IF v_channel_id IS NULL THEN
    SELECT id INTO v_channel_id
    FROM insforge_realtime.channels
    WHERE enabled = TRUE
      AND name LIKE '%\%%' ESCAPE '\'
      AND p_channel_name LIKE name
    LIMIT 1;
  END IF;

  -- If still no channel found, raise a warning and return NULL
  IF v_channel_id IS NULL THEN
    RAISE WARNING 'Realtime: No matching channel found for "%"', p_channel_name;
    RETURN NULL;
  END IF;

  -- Insert usage record (sender_type is always 'system' for DB triggers)
  INSERT INTO insforge_realtime.usage (
    event_name,
    channel_id,
    channel_name
  ) VALUES (
    p_event_name,
    v_channel_id,
    p_channel_name
  )
  RETURNING id INTO v_message_id;

  -- Send notification to RealtimeManager
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

-- Revoke execute from public, only backend can call this
REVOKE ALL ON FUNCTION insforge_realtime.send FROM PUBLIC;

-- Grant usage on schema to authenticated (for RLS policy checks)
GRANT USAGE ON SCHEMA insforge_realtime TO authenticated;
```

### Example: Developer Trigger

```sql
-- ============================================================================
-- EXAMPLE: Order Status Change Trigger
-- ============================================================================
-- Developers write their own triggers that call insforge_realtime.send()

CREATE OR REPLACE FUNCTION notify_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger on status change
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM insforge_realtime.send(
      'order:' || NEW.id::text,            -- channel_name (resolved)
      'status_changed',                    -- event_name
      jsonb_build_object(                  -- payload (custom shape)
        'order_id', NEW.id,
        'old_status', OLD.status,
        'new_status', NEW.status,
        'updated_at', NEW.updated_at
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

---

## Backend Implementation

### File Structure

```
backend/src/
├── infra/
│   ├── database/
│   │   └── database.manager.ts      # Added createClient() factory method
│   ├── realtime/
│   │   ├── realtime.manager.ts      # Listens to pg_notify, emits events
│   │   └── webhook-sender.ts        # HTTP client for webhook delivery
│   └── socket/
│       └── socket.manager.ts        # Added getRoomSize(), broadcastToRoom()
├── services/
│   └── realtime/
│       ├── channel.service.ts       # Channel CRUD
│       ├── auth.service.ts          # Join/Send permission checks via RLS
│       └── usage.service.ts         # Usage statistics queries
├── api/
│   └── routes/
│       └── realtime/
│           ├── index.routes.ts      # Router
│           ├── channels.routes.ts   # Channel CRUD endpoints
│           ├── usage.routes.ts      # Usage stats endpoints
│           └── broadcast.routes.ts  # Server-side broadcast API
└── types/
    ├── realtime.ts                  # Type definitions
    └── socket.ts                    # Extended with realtime events
```

### Types (`backend/src/types/realtime.ts`)

```typescript
/**
 * Realtime feature types and interfaces
 */

// ============================================================================
// Channel Types
// ============================================================================

export interface RealtimeChannel {
  id: string;
  name: string;
  description: string | null;
  webhookUrls: string[] | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChannelRequest {
  name: string;
  description?: string;
  webhookUrls?: string[];
  enabled?: boolean;
}

export interface UpdateChannelRequest {
  name?: string;
  description?: string;
  webhookUrls?: string[];
  enabled?: boolean;
}

// ============================================================================
// Usage Types
// ============================================================================

export interface RealtimeUsage {
  id: string;
  eventName: string;
  channelId: string | null;
  channelName: string;
  wsAudienceCount: number;
  whAudienceCount: number;
  whDeliveredCount: number;
  createdAt: string;
}

// ============================================================================
// Event Emitter Types
// ============================================================================

/**
 * Event payload received from pg_notify
 */
export interface RealtimeEvent {
  message_id: string;
  channel_id: string;
  channel_name: string;
  event_name: string;
  payload: Record<string, unknown>;
}

/**
 * Delivery statistics after event processing
 */
export interface DeliveryResult {
  wsAudienceCount: number;
  whAudienceCount: number;
  whDeliveredCount: number;
}

// ============================================================================
// WebSocket Event Types
// ============================================================================

/**
 * Payload for realtime:join client event
 */
export interface JoinChannelPayload {
  channel: string; // The resolved channel instance, e.g., "order:123"
}

/**
 * Payload for realtime:send client event
 */
export interface SendEventPayload {
  channel: string;
  event: string;
  payload: Record<string, unknown>;
}

/**
 * Payload sent to webhook endpoints
 */
export interface WebhookEventPayload {
  messageId: string;
  channel: string;
  eventName: string;
  payload: Record<string, unknown>;
}

/**
 * Payload for realtime:joined server event
 */
export interface JoinedChannelPayload {
  channel: string;
  canSend: boolean;
}

/**
 * Payload for realtime:left server event
 */
export interface LeftChannelPayload {
  channel: string;
}

/**
 * Payload for realtime:error server event
 */
export interface RealtimeErrorPayload {
  channel?: string;
  code: string;
  message: string;
}

// ============================================================================
// Permission Types
// ============================================================================

export type Permission = 'join' | 'send';

export interface ChannelPermissions {
  canJoin: boolean;
  canSend: boolean;
}
```

### Socket Types Extension (`backend/src/types/socket.ts`)

```typescript
// Add to ServerEvents enum
export enum ServerEvents {
  NOTIFICATION = 'notification',
  DATA_UPDATE = 'data:update',
  MCP_CONNECTED = 'mcp:connected',
  // Realtime events
  REALTIME_EVENT = 'realtime:event',
  REALTIME_JOINED = 'realtime:joined',
  REALTIME_LEFT = 'realtime:left',
  REALTIME_ERROR = 'realtime:error',
}

// Add to ClientEvents enum
export enum ClientEvents {
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  // Realtime events
  REALTIME_JOIN = 'realtime:join',
  REALTIME_LEAVE = 'realtime:leave',
  REALTIME_SEND = 'realtime:send',
}
```

### RealtimeManager (`backend/src/infra/realtime/realtime.manager.ts`)

```typescript
import type { Client, Pool } from 'pg';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { WebhookSender } from './webhook-sender.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import type {
  RealtimeEvent,
  RealtimeChannel,
  DeliveryResult,
  WebhookEventPayload,
} from '@/types/realtime.js';

/**
 * RealtimeManager - Listens to pg_notify and emits events to WebSocket/webhooks
 *
 * This is a singleton that:
 * 1. Maintains a dedicated PostgreSQL connection for LISTEN
 * 2. Receives notifications from insforge_realtime.send() function
 * 3. Emits events to WebSocket clients (via Socket.IO rooms)
 * 4. Emits events to webhook URLs (via HTTP POST)
 * 5. Updates usage records with delivery statistics
 */
export class RealtimeManager {
  private static instance: RealtimeManager;
  private listenerClient: Client | null = null;
  private pool: Pool | null = null;
  private isConnected = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelay = 5000;
  private webhookSender: WebhookSender;

  private constructor() {
    this.webhookSender = new WebhookSender();
  }

  static getInstance(): RealtimeManager {
    if (!RealtimeManager.instance) {
      RealtimeManager.instance = new RealtimeManager();
    }
    return RealtimeManager.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Initialize the realtime manager and start listening for pg_notify
   */
  async initialize(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    // Create a dedicated client for LISTEN (cannot use pooled connections)
    this.listenerClient = DatabaseManager.getInstance().createClient();

    try {
      await this.listenerClient.connect();
      await this.listenerClient.query('LISTEN insforge_realtime');
      this.isConnected = true;
      this.reconnectAttempts = 0;

      this.listenerClient.on('notification', (msg) => {
        if (msg.channel === 'insforge_realtime' && msg.payload) {
          void this.handlePGNotification(msg.payload);
        }
      });

      this.listenerClient.on('error', (error) => {
        logger.error('RealtimeManager connection error', { error: error.message });
        this.handleDisconnect();
      });

      this.listenerClient.on('end', () => {
        logger.warn('RealtimeManager connection ended');
        this.handleDisconnect();
      });

      logger.info('RealtimeManager initialized and listening');
    } catch (error) {
      logger.error('Failed to initialize RealtimeManager', { error });
      this.handleDisconnect();
    }
  }

  /**
   * Handle incoming pg_notify notification
   */
  private async handlePGNotification(payload: string): Promise<void> {
    let event: RealtimeEvent;

    try {
      event = JSON.parse(payload) as RealtimeEvent;
    } catch (error) {
      logger.error('Failed to parse pg_notify payload', { error, payload });
      return;
    }

    const { message_id, channel_id, event_name } = event;

    try {
      // 1. Look up channel configuration
      const channel = await this.getChannelById(channel_id);

      if (!channel) {
        logger.warn('Channel not found for realtime event', { channel_id });
        return;
      }

      if (!channel.enabled) {
        logger.debug('Channel is disabled, skipping event', { channelName: channel.name });
        return;
      }

      // 2. Emit to WebSocket and/or Webhooks
      const result = await this.emitEvent(event, channel);

      // 3. Update usage record with delivery stats
      await this.updateUsageRecord(message_id, result);

      logger.debug('Realtime event emitted', {
        message_id,
        channelName: channel.name,
        event_name,
        ...result,
      });
    } catch (error) {
      logger.error('Failed to emit realtime event', {
        error,
        message_id,
        channel_id,
        event_name,
      });
    }
  }

  /**
   * Emit event to WebSocket clients and webhook URLs
   */
  private async emitEvent(event: RealtimeEvent, channel: RealtimeChannel): Promise<DeliveryResult> {
    const result: DeliveryResult = {
      wsAudienceCount: 0,
      whAudienceCount: 0,
      whDeliveredCount: 0,
    };

    const { message_id, channel_name, event_name, payload } = event;

    // Emit to WebSocket clients
    result.wsAudienceCount = this.emitToWebSocket(channel_name, event_name, payload);

    // Emit to Webhook URLs if configured
    if (channel.webhookUrls && channel.webhookUrls.length > 0) {
      const webhookPayload: WebhookEventPayload = {
        messageId: message_id,
        channel: channel_name,
        eventName: event_name,
        payload,
      };
      const whResult = await this.emitToWebhooks(channel.webhookUrls, webhookPayload);
      result.whAudienceCount = whResult.audienceCount;
      result.whDeliveredCount = whResult.deliveredCount;
    }

    return result;
  }

  /**
   * Emit event to WebSocket clients subscribed to the channel
   * Returns the number of clients in the room (audience count)
   */
  private emitToWebSocket(
    channelName: string,
    eventName: string,
    payload: Record<string, unknown>
  ): number {
    const socketManager = SocketManager.getInstance();
    const roomName = `realtime:${channelName}`;

    const audienceCount = socketManager.getRoomSize(roomName);

    if (audienceCount > 0) {
      socketManager.broadcastToRoom(roomName, eventName, payload);
    }

    return audienceCount;
  }

  /**
   * Emit event to all configured webhook URLs
   */
  private async emitToWebhooks(
    urls: string[],
    payload: WebhookEventPayload
  ): Promise<{ audienceCount: number; deliveredCount: number }> {
    const audienceCount = urls.length;
    const results = await this.webhookSender.sendToAll(urls, payload);
    const deliveredCount = results.filter((r) => r.success).length;

    return { audienceCount, deliveredCount };
  }

  /**
   * Get channel configuration by ID
   */
  private async getChannelById(channelId: string): Promise<RealtimeChannel | null> {
    const result = await this.getPool().query(
      `SELECT
        id,
        name,
        description,
        webhook_urls as "webhookUrls",
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM insforge_realtime.channels
      WHERE id = $1`,
      [channelId]
    );

    return result.rows[0] || null;
  }

  /**
   * Update usage record with delivery statistics
   */
  private async updateUsageRecord(messageId: string, result: DeliveryResult): Promise<void> {
    await this.getPool().query(
      `UPDATE insforge_realtime.usage
       SET
         ws_audience_count = $2,
         wh_audience_count = $3,
         wh_delivered_count = $4
       WHERE id = $1`,
      [messageId, result.wsAudienceCount, result.whAudienceCount, result.whDeliveredCount]
    );
  }

  /**
   * Handle disconnection and attempt reconnection
   */
  private handleDisconnect(): void {
    this.isConnected = false;

    if (this.listenerClient) {
      this.listenerClient.removeAllListeners();
      this.listenerClient = null;
    }

    // Reconnect with exponential backoff
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
      this.reconnectAttempts++;

      if (!this.reconnectTimeout) {
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          logger.info(`Attempting to reconnect RealtimeManager (attempt ${this.reconnectAttempts})...`);
          void this.initialize();
        }, delay);
      }
    } else {
      logger.error('RealtimeManager max reconnect attempts reached');
    }
  }

  /**
   * Close the realtime manager connection
   */
  async close(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.listenerClient) {
      this.listenerClient.removeAllListeners();
      await this.listenerClient.end();
      this.listenerClient = null;
      this.isConnected = false;
      logger.info('RealtimeManager closed');
    }
  }

  /**
   * Check if the manager is connected and healthy
   */
  isHealthy(): boolean {
    return this.isConnected;
  }
}
```

### Webhook Sender (`backend/src/infra/realtime/webhook-sender.ts`)

```typescript
import axios, { AxiosError } from 'axios';
import logger from '@/utils/logger.js';
import type { WebhookEventPayload } from '@/types/realtime.js';

export interface WebhookResult {
  url: string;
  success: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Sends events to configured webhook URLs with retry logic
 */
export class WebhookSender {
  private readonly timeout = 10000; // 10 seconds
  private readonly maxRetries = 2;

  /**
   * Send event to all webhook URLs in parallel
   */
  async sendToAll(urls: string[], payload: WebhookEventPayload): Promise<WebhookResult[]> {
    const promises = urls.map((url) => this.sendToOne(url, payload));
    return Promise.all(promises);
  }

  /**
   * Send event to a single webhook URL with retry logic
   */
  private async sendToOne(url: string, payload: WebhookEventPayload): Promise<WebhookResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await axios.post(url, payload, {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json',
            'X-InsForge-Event': payload.eventName,
            'X-InsForge-Channel': payload.channel,
            'X-InsForge-Message-Id': payload.messageId,
          },
        });

        return {
          url,
          success: response.status >= 200 && response.status < 300,
          statusCode: response.status,
        };
      } catch (error) {
        const axiosError = error as AxiosError;
        lastError = axiosError.message;

        if (axiosError.response) {
          // Server responded with error status
          return {
            url,
            success: false,
            statusCode: axiosError.response.status,
            error: `HTTP ${axiosError.response.status}`,
          };
        }

        // Network error, retry
        if (attempt < this.maxRetries) {
          await this.delay(1000 * (attempt + 1)); // 1s, 2s, 3s
        }
      }
    }

    logger.warn('Webhook delivery failed after retries', { url, error: lastError });

    return {
      url,
      success: false,
      error: lastError,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

### DatabaseManager Extension (`backend/src/infra/database/database.manager.ts`)

Added factory method for dedicated LISTEN connections:

```typescript
/**
 * Create a dedicated client for operations that can't use pooled connections (e.g., LISTEN/NOTIFY)
 */
createClient(): Client {
  return new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'insforge',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
  });
}
```

### SocketManager Extension (`backend/src/infra/socket/socket.manager.ts`)

Added methods for realtime support:

```typescript
/**
 * Get the number of sockets in a room
 */
getRoomSize(room: string): number {
  if (!this.io) {
    return 0;
  }
  const roomSockets = this.io.sockets.adapter.rooms.get(room);
  return roomSockets?.size || 0;
}

/**
 * Broadcast to specific room
 * Adds messageId (if not present) and timestamp to payload
 */
broadcastToRoom<T extends object>(room: string, event: string, payload: T): void {
  if (!this.io) {
    logger.warn('Socket.IO server not initialized');
    return;
  }

  const message = this.buildMessage(payload);
  this.io.to(room).emit(event, message);

  logger.debug('Broadcasted message to room', {
    event,
    room,
  });
}
```

---

## Phase 2: Services & API

### Realtime Auth Service (`backend/src/services/realtime/auth.service.ts`)

```typescript
import { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager';
import logger from '@/utils/logger';
import type { ChannelPermissions } from '@/types/realtime';

/**
 * Handles channel authorization by checking RLS policies.
 *
 * Developers define RLS policies on insforge_realtime.channels that check:
 * - current_setting('realtime.permission', true) = 'join' or 'send'
 * - current_setting('realtime.channel_instance', true) = the actual channel name
 * - current_setting('request.jwt.claim.sub', true) = user ID
 * - current_setting('request.jwt.claim.role', true) = user role
 */
export class RealtimeAuthService {
  private static instance: RealtimeAuthService;
  private pool: Pool | null = null;

  private constructor() {}

  static getInstance(): RealtimeAuthService {
    if (!RealtimeAuthService.instance) {
      RealtimeAuthService.instance = new RealtimeAuthService();
    }
    return RealtimeAuthService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Check what permissions a user has for a channel.
   * Returns { canJoin, canSend } based on RLS policies.
   */
  async getPermissions(
    channelInstance: string,
    userId: string | undefined,
    userRole: string | undefined
  ): Promise<ChannelPermissions> {
    const client = await this.getPool().connect();

    try {
      await this.setUserContext(client, userId, userRole, channelInstance);

      // Check join permission
      const canJoin = await this.checkPermission(client, channelInstance, 'join');

      // Check send permission
      const canSend = await this.checkPermission(client, channelInstance, 'send');

      return { canJoin, canSend };
    } catch (error) {
      logger.error('Failed to check channel permissions', {
        channelInstance,
        userId,
        error,
      });
      return { canJoin: false, canSend: false };
    } finally {
      client.release();
    }
  }

  private async checkPermission(
    client: PoolClient,
    channelInstance: string,
    permission: 'join' | 'send'
  ): Promise<boolean> {
    // Set the permission being checked
    await client.query("SELECT set_config('realtime.permission', $1, true)", [permission]);

    // Find matching channel pattern
    const channelPattern = await this.findMatchingChannelPattern(client, channelInstance);

    if (!channelPattern) {
      return false;
    }

    // Query with RLS applied
    const result = await client.query(
      `SELECT id FROM insforge_realtime.channels
       WHERE name = $1 AND enabled = TRUE
       LIMIT 1`,
      [channelPattern]
    );

    return result.rowCount !== null && result.rowCount > 0;
  }

  private async findMatchingChannelPattern(
    client: PoolClient,
    channelInstance: string
  ): Promise<string | null> {
    // Exact match first
    const exactResult = await client.query(
      `SELECT name FROM insforge_realtime.channels
       WHERE name = $1 AND enabled = TRUE
       LIMIT 1`,
      [channelInstance]
    );

    if (exactResult.rowCount && exactResult.rowCount > 0) {
      return exactResult.rows[0].name;
    }

    // Pattern matching for wildcards like "order:%"
    const patternsResult = await client.query(
      `SELECT name FROM insforge_realtime.channels
       WHERE enabled = TRUE AND name LIKE '%\\%%' ESCAPE '\\'`
    );

    for (const row of patternsResult.rows) {
      const pattern = row.name as string;
      // Convert SQL LIKE pattern to regex: order:% -> ^order:[^:]+$
      const regex = this.patternToRegex(pattern);
      if (regex.test(channelInstance)) {
        return pattern;
      }
    }

    return null;
  }

  private patternToRegex(pattern: string): RegExp {
    // Escape regex special chars, then convert % to [^:]+ (match segment)
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const withWildcards = escaped.replace(/%/g, '[^:]+');
    return new RegExp(`^${withWildcards}$`);
  }

  private async setUserContext(
    client: PoolClient,
    userId: string | undefined,
    userRole: string | undefined,
    channelInstance: string
  ): Promise<void> {
    if (userId) {
      await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await client.query("SELECT set_config('request.jwt.claim.role', $1, true)", [
        userRole || 'authenticated',
      ]);
    } else {
      await client.query("SELECT set_config('request.jwt.claim.sub', '', true)");
      await client.query("SELECT set_config('request.jwt.claim.role', 'anon', true)");
    }

    await client.query("SELECT set_config('realtime.channel_instance', $1, true)", [
      channelInstance,
    ]);
  }
}
```

### Channel Service (`backend/src/services/realtime/channel.service.ts`)

```typescript
import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager';
import { AppError } from '@/api/middlewares/error';
import { ERROR_CODES } from '@/types/error-constants';
import logger from '@/utils/logger';
import type { RealtimeChannel, CreateChannelRequest, UpdateChannelRequest } from '@/types/realtime';

export class RealtimeChannelService {
  private static instance: RealtimeChannelService;
  private pool: Pool | null = null;

  private constructor() {}

  static getInstance(): RealtimeChannelService {
    if (!RealtimeChannelService.instance) {
      RealtimeChannelService.instance = new RealtimeChannelService();
    }
    return RealtimeChannelService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  async list(): Promise<RealtimeChannel[]> {
    const result = await this.getPool().query(`
      SELECT
        id,
        name,
        description,
        webhook_urls as "webhookUrls",
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM insforge_realtime.channels
      ORDER BY created_at DESC
    `);
    return result.rows;
  }

  async getById(id: string): Promise<RealtimeChannel | null> {
    const result = await this.getPool().query(
      `SELECT
        id,
        name,
        description,
        webhook_urls as "webhookUrls",
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM insforge_realtime.channels
      WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async create(input: CreateChannelRequest): Promise<RealtimeChannel> {
    this.validateChannelName(input.name);

    const result = await this.getPool().query(
      `INSERT INTO insforge_realtime.channels (
        name, description, webhook_urls, enabled
      ) VALUES ($1, $2, $3, $4)
      RETURNING
        id,
        name,
        description,
        webhook_urls as "webhookUrls",
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"`,
      [
        input.name,
        input.description || null,
        input.webhookUrls || null,
        input.enabled ?? true,
      ]
    );

    logger.info('Realtime channel created', { name: input.name });
    return result.rows[0];
  }

  async update(id: string, input: UpdateChannelRequest): Promise<RealtimeChannel> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new AppError('Channel not found', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    }

    if (input.name) {
      this.validateChannelName(input.name);
    }

    const result = await this.getPool().query(
      `UPDATE insforge_realtime.channels
       SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         webhook_urls = COALESCE($4, webhook_urls),
         enabled = COALESCE($5, enabled)
       WHERE id = $1
       RETURNING
         id,
         name,
         description,
         webhook_urls as "webhookUrls",
         enabled,
         created_at as "createdAt",
         updated_at as "updatedAt"`,
      [
        id,
        input.name,
        input.description,
        input.webhookUrls,
        input.enabled,
      ]
    );

    logger.info('Realtime channel updated', { id });
    return result.rows[0];
  }

  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new AppError('Channel not found', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    }

    await this.getPool().query('DELETE FROM insforge_realtime.channels WHERE id = $1', [id]);
    logger.info('Realtime channel deleted', { id, name: existing.name });
  }

  private validateChannelName(name: string): void {
    // Allow alphanumeric, colons, hyphens, underscores, and % for wildcards
    const validPattern = /^[a-zA-Z0-9_-]+(:[a-zA-Z0-9_%:-]+)*$/;
    if (!validPattern.test(name)) {
      throw new AppError(
        'Invalid channel name. Use alphanumeric characters, colons, hyphens, underscores, and % for wildcards.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
  }
}
```

### Usage Service (`backend/src/services/realtime/usage.service.ts`)

```typescript
import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager';
import type { RealtimeUsage } from '@/types/realtime';

export class RealtimeUsageService {
  private static instance: RealtimeUsageService;
  private pool: Pool | null = null;

  private constructor() {}

  static getInstance(): RealtimeUsageService {
    if (!RealtimeUsageService.instance) {
      RealtimeUsageService.instance = new RealtimeUsageService();
    }
    return RealtimeUsageService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  async list(options: {
    channelId?: string;
    eventName?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<RealtimeUsage[]> {
    const { channelId, eventName, limit = 100, offset = 0 } = options;

    let query = `
      SELECT
        id,
        event_name as "eventName",
        channel_id as "channelId",
        channel_name as "channelName",
        ws_audience_count as "wsAudienceCount",
        wh_audience_count as "whAudienceCount",
        wh_delivered_count as "whDeliveredCount",
        created_at as "createdAt"
      FROM insforge_realtime.usage
      WHERE 1=1
    `;

    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (channelId) {
      query += ` AND channel_id = $${paramIndex++}`;
      params.push(channelId);
    }

    if (eventName) {
      query += ` AND event_name = $${paramIndex++}`;
      params.push(eventName);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await this.getPool().query(query, params);
    return result.rows;
  }

  async getStats(options: {
    channelId?: string;
    since?: Date;
  } = {}): Promise<{
    totalEvents: number;
    whDeliveryRate: number;
    topEvents: { eventName: string; count: number }[];
  }> {
    const { channelId, since } = options;

    let whereClause = '1=1';
    const params: (string | Date)[] = [];
    let paramIndex = 1;

    if (channelId) {
      whereClause += ` AND channel_id = $${paramIndex++}`;
      params.push(channelId);
    }

    if (since) {
      whereClause += ` AND created_at >= $${paramIndex++}`;
      params.push(since);
    }

    const statsResult = await this.getPool().query(
      `SELECT
        COUNT(*) as total_events,
        SUM(wh_audience_count) as wh_audience_total,
        SUM(wh_delivered_count) as wh_delivered_total
      FROM insforge_realtime.usage
      WHERE ${whereClause}`,
      params
    );

    const topEventsResult = await this.getPool().query(
      `SELECT event_name, COUNT(*) as count
       FROM insforge_realtime.usage
       WHERE ${whereClause}
       GROUP BY event_name
       ORDER BY count DESC
       LIMIT 10`,
      params
    );

    const stats = statsResult.rows[0];
    const whAudienceTotal = parseInt(stats.wh_audience_total) || 0;
    const whDeliveredTotal = parseInt(stats.wh_delivered_total) || 0;

    return {
      totalEvents: parseInt(stats.total_events) || 0,
      whDeliveryRate: whAudienceTotal > 0 ? whDeliveredTotal / whAudienceTotal : 0,
      topEvents: topEventsResult.rows.map((row) => ({
        eventName: row.event_name,
        count: parseInt(row.count),
      })),
    };
  }
}
```

### Socket Manager Extensions

Add to `SocketManager` class in `setupClientEventHandlers`:

```typescript
import { RealtimeAuthService } from '@/services/realtime/auth.service';
import type { JoinChannelPayload, SendEventPayload } from '@/types/realtime';

// Handle join channel request
socket.on(ClientEvents.REALTIME_JOIN, async (payload: JoinChannelPayload) => {
  const authService = RealtimeAuthService.getInstance();
  const { channel } = payload;

  try {
    const permissions = await authService.getPermissions(
      channel,
      socket.data.user?.id,
      socket.data.user?.role
    );

    if (permissions.canJoin) {
      const roomName = `realtime:${channel}`;
      await socket.join(roomName);

      const metadata = this.socketMetadata.get(socket.id);
      if (metadata) {
        metadata.subscriptions.add(roomName);
      }

      // Store permissions for later send checks
      if (!socket.data.realtimePermissions) {
        socket.data.realtimePermissions = new Map();
      }
      socket.data.realtimePermissions.set(channel, permissions);

      socket.emit(ServerEvents.REALTIME_JOINED, {
        channel,
        canSend: permissions.canSend,
      });

      logger.debug('Socket joined realtime channel', {
        socketId: socket.id,
        channel,
        canSend: permissions.canSend,
      });
    } else {
      socket.emit(ServerEvents.REALTIME_ERROR, {
        channel,
        code: 'UNAUTHORIZED',
        message: 'Not authorized to join this channel',
      });
    }
  } catch (error) {
    logger.error('Error handling realtime join', { error, channel });
    socket.emit(ServerEvents.REALTIME_ERROR, {
      channel,
      code: 'INTERNAL_ERROR',
      message: 'Failed to join channel',
    });
  }
});

// Handle leave channel request
socket.on(ClientEvents.REALTIME_LEAVE, (payload: JoinChannelPayload) => {
  const { channel } = payload;
  const roomName = `realtime:${channel}`;

  void socket.leave(roomName);

  const metadata = this.socketMetadata.get(socket.id);
  if (metadata) {
    metadata.subscriptions.delete(roomName);
  }

  // Clear cached permissions
  socket.data.realtimePermissions?.delete(channel);

  socket.emit(ServerEvents.REALTIME_LEFT, { channel });
  logger.debug('Socket left realtime channel', { socketId: socket.id, channel });
});
```

---

## API Routes

### Channels Routes (`backend/src/api/routes/realtime/channels.routes.ts`)

```typescript
import { Router } from 'express';
import { verifyAdmin } from '@/api/middlewares/auth';
import { RealtimeChannelService } from '@/services/realtime/channel.service';
import { successResponse } from '@/utils/response';

const router = Router();
const channelService = RealtimeChannelService.getInstance();

router.get('/', verifyAdmin, async (req, res, next) => {
  try {
    const channels = await channelService.list();
    successResponse(res, channels);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', verifyAdmin, async (req, res, next) => {
  try {
    const channel = await channelService.getById(req.params.id);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    successResponse(res, channel);
  } catch (error) {
    next(error);
  }
});

router.post('/', verifyAdmin, async (req, res, next) => {
  try {
    const channel = await channelService.create(req.body);
    successResponse(res, channel, 201);
  } catch (error) {
    next(error);
  }
});

router.put('/:id', verifyAdmin, async (req, res, next) => {
  try {
    const channel = await channelService.update(req.params.id, req.body);
    successResponse(res, channel);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', verifyAdmin, async (req, res, next) => {
  try {
    await channelService.delete(req.params.id);
    successResponse(res, { message: 'Channel deleted' });
  } catch (error) {
    next(error);
  }
});

export { router as channelsRouter };
```

### Usage Routes (`backend/src/api/routes/realtime/usage.routes.ts`)

```typescript
import { Router } from 'express';
import { verifyAdmin } from '@/api/middlewares/auth';
import { RealtimeUsageService } from '@/services/realtime/usage.service';
import { successResponse } from '@/utils/response';

const router = Router();
const usageService = RealtimeUsageService.getInstance();

router.get('/', verifyAdmin, async (req, res, next) => {
  try {
    const { channelId, eventName, limit, offset } = req.query;
    const usage = await usageService.list({
      channelId: channelId as string,
      eventName: eventName as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    });
    successResponse(res, usage);
  } catch (error) {
    next(error);
  }
});

router.get('/stats', verifyAdmin, async (req, res, next) => {
  try {
    const { channelId, since } = req.query;
    const stats = await usageService.getStats({
      channelId: channelId as string,
      since: since ? new Date(since as string) : undefined,
    });
    successResponse(res, stats);
  } catch (error) {
    next(error);
  }
});

export { router as usageRouter };
```

### Main Router (`backend/src/api/routes/realtime/index.routes.ts`)

```typescript
import { Router } from 'express';
import { channelsRouter } from './channels.routes';
import { usageRouter } from './usage.routes';

const router = Router();

router.use('/channels', channelsRouter);
router.use('/usage', usageRouter);

export { router as realtimeRouter };
```

---

## Server Initialization

Update `server.ts`:

```typescript
import { RealtimeManager } from '@/infra/realtime/realtime.manager';
import { realtimeRouter } from '@/api/routes/realtime/index.routes';

// After database initialization:
const realtimeManager = RealtimeManager.getInstance();
await realtimeManager.initialize();

// Register routes:
app.use('/api/realtime', realtimeRouter);

// In graceful shutdown:
await realtimeManager.close();
```

---

## API Summary

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/realtime/channels` | List all channels | Admin |
| GET | `/api/realtime/channels/:id` | Get channel details | Admin |
| POST | `/api/realtime/channels` | Create a channel | Admin |
| PUT | `/api/realtime/channels/:id` | Update a channel | Admin |
| DELETE | `/api/realtime/channels/:id` | Delete a channel | Admin |
| GET | `/api/realtime/usage` | List usage records | Admin |
| GET | `/api/realtime/usage/stats` | Get usage statistics | Admin |

## WebSocket Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `realtime:join` | `{ channel: string }` | Join a channel (e.g., "order:123") |
| `realtime:leave` | `{ channel: string }` | Leave a channel |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `<event_name>` | `{ messageId, ...payload, timestamp }` | Realtime event (event name from trigger) |
| `realtime:joined` | `{ channel, canSend }` | Successfully joined channel |
| `realtime:left` | `{ channel }` | Successfully left channel |
| `realtime:error` | `{ channel, code, message }` | Error (unauthorized, etc.) |

---

## Usage Examples

### 1. Create a Channel with Webhook

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

### 2. Developer: Create a Trigger for Order Updates

```sql
-- Developer writes their own trigger with full control
CREATE OR REPLACE FUNCTION notify_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Custom condition
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Custom payload shape
    PERFORM insforge_realtime.send(
      'order:' || NEW.id::text,            -- channel_name (resolved)
      'status_changed',                    -- event_name
      jsonb_build_object(
        'order_id', NEW.id,
        'old_status', OLD.status,
        'new_status', NEW.status,
        'updated_at', NEW.updated_at
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

### 3. Client: Join a Channel and Listen

```javascript
socket.emit('realtime:join', { channel: 'order:123' });

socket.on('realtime:joined', ({ channel, canSend }) => {
  console.log(`Joined ${channel}, canSend: ${canSend}`);
});

socket.on('status_changed', (data) => {
  console.log(`Order status changed:`, data.payload);
});
```

### 4. Custom RLS Policy for Join/Send Permissions

```sql
-- Allow users to join channels for their own orders
CREATE POLICY "join_own_orders" ON insforge_realtime.channels
  FOR SELECT USING (
    name LIKE 'order:%' AND
    current_setting('realtime.permission', true) = 'join' AND
    EXISTS (
      SELECT 1 FROM orders
      WHERE id::text = split_part(current_setting('realtime.channel_instance', true), ':', 2)
      AND user_id::text = current_setting('request.jwt.claim.sub', true)
    )
  );
```

---

## Potential Issues & Mitigations

| Issue | Impact | Mitigation |
|-------|--------|------------|
| `pg_notify` 8KB payload limit | Large payloads fail | Use selected fields or reference IDs only |
| Events lost if no listeners | Data loss during disconnects | Usage table provides audit trail; add replay API later |
| Single listener connection | Bottleneck | Reconnection with exponential backoff; horizontal scaling via Redis later |
| Webhook delivery failures | Missed notifications | Retry logic (2 retries); usage table tracks failures |
| RLS policy performance | Slow permission checks | Cache permissions per socket session |

---

## Implementation Phases

### Phase 1: Core Infrastructure ✅

- [x] Database migration: `017_create-realtime-schema.sql`
  - Schema, channels table, usage table
  - `send(channel, event, payload)` function with `%` wildcard support
  - Removed `ws_delivered_count` (Socket.IO has no delivery confirmation)
- [x] RealtimeManager (`backend/src/infra/realtime/realtime.manager.ts`)
  - Renamed from `event-emitter.ts` / `RealtimeEventEmitter`
  - Uses `DatabaseManager.createClient()` factory method
  - `emitToWebSocket` / `emitToWebhooks` naming
- [x] WebhookSender (`backend/src/infra/realtime/webhook-sender.ts`)
  - Uses `WebhookEventPayload` type
- [x] Realtime types (`backend/src/types/realtime.ts`)
  - `RealtimeEvent` (renamed from `RealtimeNotification`)
  - `DeliveryResult` without `wsDeliveredCount`
- [x] Socket types extended (`backend/src/types/socket.ts`)
- [x] DatabaseManager extended (`createClient()` factory method)
- [x] SocketManager extended (`getRoomSize()`, `broadcastToRoom()`)

### Phase 2: Services & API

- [ ] RealtimeChannelService (`backend/src/services/realtime/channel.service.ts`)
- [ ] RealtimeAuthService (`backend/src/services/realtime/auth.service.ts`)
- [ ] RealtimeUsageService (`backend/src/services/realtime/usage.service.ts`)
- [ ] Socket manager extensions (join/leave handlers)
- [ ] API routes (channels, usage)
- [ ] Server initialization

### Phase 3: Testing

- [ ] Unit tests for services
- [ ] Integration tests for WebSocket events
- [ ] Webhook delivery tests
- [ ] RLS policy testing
