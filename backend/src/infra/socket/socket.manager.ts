import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import logger from '@/utils/logger.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import { ServerEvents, ClientEvents, SocketMetadata, NotificationPayload } from '@/types/socket.js';
import type {
  SubscribeChannelPayload,
  PublishEventPayload,
  SocketMessage,
  SocketMessageMeta,
  SubscribeResponse,
  UnsubscribeChannelPayload,
} from '@insforge/shared-schemas';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES, NEXT_ACTION } from '@/types/error-constants.js';
import { RealtimeAuthService } from '@/services/realtime/realtime-auth.service.js';
import { RealtimeMessageService } from '@/services/realtime/realtime-message.service.js';

const tokenManager = TokenManager.getInstance();

/**
 * SocketManager - Industrial-grade Socket.IO implementation
 * Infrastructure layer for real-time WebSocket communication
 */
export class SocketManager {
  private static instance: SocketManager;
  private io: SocketIOServer | null = null;
  private socketMetadata: Map<string, SocketMetadata> = new Map();

  private constructor() {}

  /**
   * Singleton pattern for global socket manager access
   */
  static getInstance(): SocketManager {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  /**
   * Initialize Socket.IO server
   */
  initialize(server: HttpServer): void {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: true,
        credentials: true,
      },
    });

    this.setupConnectionHandlers();
    this.setupMiddleware();

    logger.info('Socket.IO server initialized');
  }

  /**
   * Setup authentication and validation middleware
   */
  private setupMiddleware(): void {
    if (!this.io) {
      return;
    }

    // Authentication middleware
    this.io.use((socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        const payload = tokenManager.verifyToken(token);
        if (!payload.role) {
          throw new AppError(
            'Invalid token: missing role',
            401,
            ERROR_CODES.AUTH_INVALID_CREDENTIALS,
            NEXT_ACTION.CHECK_TOKEN
          );
        }
        socket.data.user = {
          id: payload.sub,
          email: payload.email,
          role: payload.role,
        };

        next();
      } catch {
        next(
          new AppError(
            'Invalid token',
            401,
            ERROR_CODES.AUTH_INVALID_CREDENTIALS,
            NEXT_ACTION.CHECK_TOKEN
          )
        );
      }
    });
  }

  /**
   * Setup main connection handlers
   */
  private setupConnectionHandlers(): void {
    if (!this.io) {
      return;
    }

    this.io.on('connection', (socket: Socket) => {
      this.onSocketConnect(socket);

      // Setup event listeners
      this.setupClientEventHandlers(socket);

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        this.onSocketDisconnect(socket, reason);
      });

      // Handle errors
      socket.on('error', (error: Error) => {
        this.onSocketError(socket, error);
      });
    });
  }

  /**
   * Handle new socket connection (includes reconnections)
   */
  private onSocketConnect(socket: Socket): void {
    // Initialize socket metadata
    const metadata: SocketMetadata = {
      userId: socket.data.user?.id,
      role: socket.data.user?.role,
      connectedAt: new Date(),
      lastActivity: new Date(),
      subscriptions: new Set(),
    };

    this.socketMetadata.set(socket.id, metadata);

    // Join appropriate rooms based on user role
    if (metadata.userId) {
      void socket.join(`user:${metadata.userId}`);
    }
    if (metadata.role) {
      void socket.join(`role:${metadata.role}`);
    }

    // Log connection with reconnection status
    logger.info('Socket client connected', {
      socketId: socket.id,
      userId: metadata.userId,
      role: metadata.role,
      restoredSubscriptions: metadata.subscriptions.size,
    });
  }

  /**
   * Handle socket disconnection
   */
  private onSocketDisconnect(socket: Socket, reason: string): void {
    const metadata = this.socketMetadata.get(socket.id);

    logger.info('Socket client disconnected', {
      socketId: socket.id,
      userId: metadata?.userId,
      reason,
      connectionDuration: metadata ? Date.now() - metadata.connectedAt.getTime() : 0,
    });

    // Cleanup
    this.socketMetadata.delete(socket.id);
  }

  /**
   * Handle socket errors
   */
  private onSocketError(socket: Socket, error: Error): void {
    logger.error('Socket error occurred', {
      socketId: socket.id,
      error: error.message,
      stack: error.stack,
    });

    // DO NOT clean up metadata here - the socket might recover
    // The 'disconnect' event will handle cleanup when/if the socket actually disconnects
  }

  /**
   * Setup handlers for client events
   */
  private setupClientEventHandlers(socket: Socket): void {
    // Handle realtime channel subscribe with ack callback
    socket.on(
      ClientEvents.REALTIME_SUBSCRIBE,
      (payload: SubscribeChannelPayload, ack: (response: SubscribeResponse) => void) => {
        void this.handleRealtimeSubscribe(socket, payload, ack);
      }
    );

    // Handle realtime channel unsubscribe (fire-and-forget, no ack needed)
    socket.on(ClientEvents.REALTIME_UNSUBSCRIBE, (payload: UnsubscribeChannelPayload) => {
      this.handleRealtimeUnsubscribe(socket, payload);
    });

    // Handle realtime publish (client-initiated messages)
    socket.on(ClientEvents.REALTIME_PUBLISH, (payload: PublishEventPayload) => {
      void this.handleRealtimePublish(socket, payload);
    });

    // Update last activity on any event
    socket.onAny(() => {
      const metadata = this.socketMetadata.get(socket.id);
      if (metadata) {
        metadata.lastActivity = new Date();
      }
    });
  }

  /**
   * Handle realtime channel subscribe request
   */
  private async handleRealtimeSubscribe(
    socket: Socket,
    payload: SubscribeChannelPayload,
    ack?: (response: SubscribeResponse) => void
  ): Promise<void> {
    const authService = RealtimeAuthService.getInstance();
    const { channel } = payload;
    const userId = socket.data.user?.id;
    const userRole = socket.data.user?.role;

    try {
      // Check subscribe permission via RLS SELECT policy
      const canSubscribe = await authService.checkSubscribePermission(channel, userId, userRole);

      if (!canSubscribe) {
        ack?.({
          ok: false,
          channel,
          error: { code: 'UNAUTHORIZED', message: 'Not authorized to subscribe to this channel' },
        });
        return;
      }

      const roomName = `realtime:${channel}`;
      await socket.join(roomName);

      const metadata = this.socketMetadata.get(socket.id);
      if (metadata) {
        metadata.subscriptions.add(roomName);
      }

      ack?.({ ok: true, channel });

      logger.debug('Socket subscribed to realtime channel', {
        socketId: socket.id,
        channel,
      });
    } catch (error) {
      logger.error('Error handling realtime subscribe', { error, channel });
      ack?.({
        ok: false,
        channel,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to subscribe to channel' },
      });
    }
  }

  /**
   * Handle realtime channel unsubscribe request (fire-and-forget)
   */
  private handleRealtimeUnsubscribe(socket: Socket, payload: UnsubscribeChannelPayload): void {
    const { channel } = payload;
    const roomName = `realtime:${channel}`;

    void socket.leave(roomName);

    const metadata = this.socketMetadata.get(socket.id);
    if (metadata) {
      metadata.subscriptions.delete(roomName);
    }

    logger.debug('Socket unsubscribed from realtime channel', { socketId: socket.id, channel });
  }

  /**
   * Handle realtime publish request (client-initiated message)
   * Inserts message to DB - trigger handles pg_notify, broadcast, and stats update.
   */
  private async handleRealtimePublish(socket: Socket, payload: PublishEventPayload): Promise<void> {
    const { channel, event, payload: eventPayload } = payload;
    const userId = socket.data.user?.id;
    const userRole = socket.data.user?.role;

    // Check if client has subscribed to this channel
    const roomName = `realtime:${channel}`;
    const metadata = this.socketMetadata.get(socket.id);
    if (!metadata?.subscriptions.has(roomName)) {
      socket.emit(ServerEvents.REALTIME_ERROR, {
        channel,
        code: 'NOT_SUBSCRIBED',
        message: 'Must subscribe to channel before publishing messages',
      });
      return;
    }

    try {
      // Insert message directly - trigger will handle pg_notify and broadcasting
      const messageService = RealtimeMessageService.getInstance();
      const result = await messageService.insertMessage(
        channel,
        event,
        eventPayload,
        userId,
        userRole
      );

      if (!result) {
        socket.emit(ServerEvents.REALTIME_ERROR, {
          channel,
          code: 'UNAUTHORIZED',
          message: 'Not authorized to publish to this channel',
        });
        return;
      }

      logger.debug('Client message inserted', {
        socketId: socket.id,
        channel,
        event,
      });
    } catch (error) {
      logger.error('Error handling realtime publish', { error, channel });
      socket.emit(ServerEvents.REALTIME_ERROR, {
        channel,
        code: 'INTERNAL_ERROR',
        message: 'Failed to publish message',
      });
    }
  }

  /**
   * Build a SocketMessage with meta and payload
   */
  private buildSocketMessage<T extends object>(
    payload: T,
    meta: Omit<SocketMessageMeta, 'messageId' | 'timestamp'> & { messageId?: string }
  ): SocketMessage & T {
    return {
      ...payload,
      meta: {
        ...meta,
        messageId: meta.messageId || this.generateMessageId(),
        timestamp: new Date().toISOString(),
      },
    } as SocketMessage & T;
  }

  /**
   * Emit message to specific socket
   */
  emitToSocket<T extends object>(
    socket: Socket,
    event: string,
    payload: T,
    senderType: 'system' | 'user' = 'system',
    senderId?: string,
    messageId?: string
  ): void {
    const message = this.buildSocketMessage(payload, {
      channel: socket.id,
      senderType,
      senderId,
      messageId,
    });
    socket.emit(event, message);
  }

  /**
   * Broadcast to all connected clients
   */
  broadcastToAll<T extends object>(
    event: string,
    payload: T,
    senderType: 'system' | 'user' = 'system',
    senderId?: string,
    messageId?: string
  ): void {
    if (!this.io) {
      logger.warn('Socket.IO server not initialized');
      return;
    }

    const message = this.buildSocketMessage(payload, { senderType, senderId, messageId });
    this.io.emit(event, message);

    logger.info('Broadcasted message to all clients', {
      event,
      clientsCount: this.getConnectionCount(),
    });
  }

  /**
   * Broadcast to specific room
   */
  broadcastToRoom<T extends object>(
    room: string,
    event: string,
    payload: T,
    senderType: 'system' | 'user',
    senderId?: string,
    messageId?: string
  ): void {
    if (!this.io) {
      logger.warn('Socket.IO server not initialized');
      return;
    }

    const message = this.buildSocketMessage(payload, {
      channel: room,
      senderType,
      senderId,
      messageId,
    });
    this.io.to(room).emit(event, message);

    logger.debug('Broadcasted message to room', { event, room });
  }

  /**
   * Get the number of sockets in a room
   */
  getRoomSize(room: string): number {
    if (!this.io) {
      return 0;
    }
    return this.io.sockets.adapter.rooms.get(room)?.size || 0;
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return crypto.randomUUID();
  }

  /**
   * Get current connection count
   */
  getConnectionCount(): number {
    return this.socketMetadata.size;
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    total: number;
    authenticated: number;
    averageConnectionTime: number;
  } {
    const connections = Array.from(this.socketMetadata.values());
    const authenticated = connections.filter((m) => m.userId).length;
    const avgTime =
      connections.reduce((acc, m) => {
        return acc + (Date.now() - m.connectedAt.getTime());
      }, 0) / (connections.length || 1);

    return {
      total: connections.length,
      authenticated,
      averageConnectionTime: avgTime,
    };
  }

  /**
   * Clean up inactive connections (can be called periodically)
   */
  cleanupInactiveConnections(maxInactivityMs: number = 300000): void {
    const now = Date.now();

    this.socketMetadata.forEach((metadata, socketId) => {
      const inactivityTime = now - metadata.lastActivity.getTime();

      if (inactivityTime > maxInactivityMs) {
        const socket = this.io?.sockets.sockets.get(socketId);
        if (socket) {
          logger.info('Disconnecting inactive socket', {
            socketId,
            inactivityTime,
          });
          socket.disconnect(true);
        }
      }
    });
  }

  /**
   * Gracefully close the Socket.IO server
   */
  close(): void {
    if (this.io) {
      // Notify all clients about server shutdown
      this.broadcastToAll(ServerEvents.NOTIFICATION, {
        level: 'warning',
        title: 'Server Shutdown',
        message: 'Server is shutting down',
      } as NotificationPayload);

      // Close all connections
      void this.io.close();
      logger.info('Socket.IO server closed');
    }

    // Clear metadata
    this.socketMetadata.clear();
  }
}

// Export singleton instance for convenience
export const socketService = SocketManager.getInstance();
