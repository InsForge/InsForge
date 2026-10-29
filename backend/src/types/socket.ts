/**
 * Socket.IO event types and interfaces
 */

/**
 * Server-to-Client events
 */
export enum ServerEvents {
  NOTIFICATION = 'notification',
  // Realtime events
  REALTIME_ERROR = 'realtime:error',
  // Presence events
  PRESENCE_JOIN = 'presence:join',
  PRESENCE_LEAVE = 'presence:leave',
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

/**
 * Socket metadata attached to each socket instance
 */
export interface SocketMetadata {
  userId?: string;
  role?: string;
  connectedAt: Date;
  subscriptions: Set<string>;
}
