import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import logger from '@/utils/logger.js';
import { AuthService } from '@/services/auth/auth.service.js';
import {
  ServerEvents,
  ClientEvents,
  SocketMessage,
  SocketMetadata,
  NotificationPayload,
  SubscribePayload,
  UnsubscribePayload,
} from '@/types/socket.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES, NEXT_ACTION } from '@/types/error-constants.js';

const authService = AuthService.getInstance();

/**
 * SocketService - Industrial-grade Socket.IO implementation
 * Follows best practices for real-time communication
 */
export class SocketService {
  private static instance: SocketService;
  private io: SocketIOServer | null = null;
  private socketMetadata: Map<string, SocketMetadata> = new Map();

  private constructor() {}

  /**
   * Singleton pattern for global socket service access
   */
  static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
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
        const payload = authService.verifyToken(token);
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
    // Handle subscription requests
    socket.on(ClientEvents.SUBSCRIBE, (payload: SubscribePayload) => {
      this.handleSubscribe(socket, payload);
    });

    // Handle unsubscription requests
    socket.on(ClientEvents.UNSUBSCRIBE, (payload: UnsubscribePayload) => {
      this.handleUnsubscribe(socket, payload);
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
   * Handle channel subscription
   */
  private handleSubscribe(socket: Socket, payload: SubscribePayload): void {
    const metadata = this.socketMetadata.get(socket.id);
    if (!metadata) {
      return;
    }

    void socket.join(payload.channel);
    metadata.subscriptions.add(payload.channel);

    logger.debug('Socket subscribed to channel', {
      socketId: socket.id,
      channel: payload.channel,
    });
  }

  /**
   * Handle channel unsubscription
   */
  private handleUnsubscribe(socket: Socket, payload: UnsubscribePayload): void {
    const metadata = this.socketMetadata.get(socket.id);
    if (!metadata) {
      return;
    }

    void socket.leave(payload.channel);
    metadata.subscriptions.delete(payload.channel);

    logger.debug('Socket unsubscribed from channel', {
      socketId: socket.id,
      channel: payload.channel,
    });
  }

  /**
   * Emit event to specific socket with type safety
   */
  emitToSocket<T>(socket: Socket, event: ServerEvents, payload: T): void {
    const message: SocketMessage<T> = {
      type: event,
      payload,
      timestamp: Date.now(),
      id: this.generateMessageId(),
    };
    socket.emit(event, message);
  }

  /**
   * Broadcast to all connected clients
   */
  broadcastToAll<T>(event: ServerEvents, payload: T): void {
    if (!this.io) {
      logger.warn('Socket.IO server not initialized');
      return;
    }

    const message: SocketMessage<T> = {
      type: event,
      payload,
      timestamp: Date.now(),
      id: this.generateMessageId(),
    };

    this.io.emit(event, message);

    logger.info('Broadcasted message to all clients', {
      event,
      clientsCount: this.getConnectionCount(),
    });
  }

  /**
   * Broadcast to specific room
   */
  broadcastToRoom<T>(room: string, event: ServerEvents, payload?: T): void {
    if (!this.io) {
      logger.warn('Socket.IO server not initialized');
      return;
    }

    const message: SocketMessage<T> = {
      type: event,
      payload,
      timestamp: Date.now(),
      id: this.generateMessageId(),
    };

    this.io.to(room).emit(event, message);

    logger.info('Broadcasted message to room', {
      event,
      room,
    });
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
      this.broadcastToAll<NotificationPayload>(ServerEvents.NOTIFICATION, {
        level: 'warning',
        title: 'Server Shutdown',
        message: 'Server is shutting down',
      });

      // Close all connections
      void this.io.close();
      logger.info('Socket.IO server closed');
    }

    // Clear metadata
    this.socketMetadata.clear();
  }
}

// Export singleton instance for convenience
export const socketService = SocketService.getInstance();
