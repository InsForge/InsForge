/**
 * Socket.IO event types and interfaces
 * Following industrial standards for type-safe WebSocket communication
 */

/**
 * Server-to-Client events
 */
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

/**
 * Client-to-Server events
 */
export enum ClientEvents {
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  // Realtime events
  REALTIME_JOIN = 'realtime:join',
  REALTIME_LEAVE = 'realtime:leave',
  REALTIME_SEND = 'realtime:send',
}

/**
 * Server event payloads
 */

export interface NotificationPayload {
  level: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
}

export enum DataUpdateResourceType {
  DATABASE = 'database',
  USERS = 'users',
  RECORDS = 'records',
  BUCKETS = 'buckets',
  FUNCTIONS = 'functions',
}

export interface DataUpdatePayload {
  resource: DataUpdateResourceType;
  action: 'created' | 'updated' | 'deleted';
  data: unknown;
}

/**
 * Client event payloads
 */
export interface SubscribePayload {
  channel: string;
  filters?: Record<string, unknown>;
}

export interface UnsubscribePayload {
  channel: string;
}

/**
 * Socket metadata attached to each socket instance
 */
export interface SocketMetadata {
  userId?: string;
  role?: string;
  connectedAt: Date;
  lastActivity: Date;
  subscriptions: Set<string>;
}
