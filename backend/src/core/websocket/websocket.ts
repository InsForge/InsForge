import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

export interface WebSocketMessage {
  type: string;
  payload?: any;
  timestamp: number;
}

export class WebSocketService {
  private static instance: WebSocketService;
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  private constructor() {}

  static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  initialize(server: Server): void {
    this.wss = new WebSocketServer({
      server,
      path: '/ws/onboarding',
    });

    this.wss.on('connection', (ws: WebSocket) => {
      // Add client to the set
      this.clients.add(ws);

      // Send welcome message
      this.sendToClient(ws, {
        type: 'connection_established',
        payload: { message: 'WebSocket connection established' },
        timestamp: Date.now(),
      });

      // Handle client messages
      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(ws, message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        this.clients.delete(ws);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error('WebSocket client error:', error);
        this.clients.delete(ws);
      });
    });
  }

  private handleClientMessage(ws: WebSocket, message: any): void {
    // Handle ping/pong for connection health
    if (message.type === 'ping') {
      this.sendToClient(ws, {
        type: 'pong',
        timestamp: Date.now(),
      });
    }
  }

  private sendToClient(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // Public method to broadcast backend connection success
  broadcastBackendConnectionSuccess(): void {
    const message: WebSocketMessage = {
      type: 'backend_connection_success',
      payload: {
        message: 'Backend connection test successful',
        step: 3,
        status: 'connected',
      },
      timestamp: Date.now(),
    };

    this.broadcast(message);
  }

  // Alias for backward compatibility
  broadcastMCPConnectionSuccess(): void {
    this.broadcastBackendConnectionSuccess();
  }

  // Broadcast message to all connected clients
  private broadcast(message: WebSocketMessage): void {
    const messageStr = JSON.stringify(message);

    // Remove disconnected clients and send to active ones
    const disconnectedClients: WebSocket[] = [];

    this.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      } else {
        disconnectedClients.push(ws);
      }
    });

    // Clean up disconnected clients
    disconnectedClients.forEach((ws) => {
      this.clients.delete(ws);
    });
  }

  // Get connection status
  getConnectionCount(): number {
    return this.clients.size;
  }

  // Close all connections
  close(): void {
    if (this.wss) {
      this.wss.close();
    }
    this.clients.clear();
  }
}
