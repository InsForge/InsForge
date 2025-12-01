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
  REALTIME_SUBSCRIBED = 'realtime:subscribed',
  REALTIME_UNSUBSCRIBED = 'realtime:unsubscribed',
  REALTIME_ERROR = 'realtime:error',
}

/**
 * Client-to-Server events
 */
export enum ClientEvents {
  // Realtime events
  REALTIME_SUBSCRIBE = 'realtime:subscribe',
  REALTIME_UNSUBSCRIBE = 'realtime:unsubscribe',
  REALTIME_PUBLISH = 'realtime:publish',
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
 * Socket metadata attached to each socket instance
 */
export interface SocketMetadata {
  userId?: string;
  role?: string;
  connectedAt: Date;
  lastActivity: Date;
  subscriptions: Set<string>;
}
