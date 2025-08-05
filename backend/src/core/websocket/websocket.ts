import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

export interface WebSocketMessage {
  type: string;
  payload?: unknown;
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
      this.clients.add(ws);

      this.sendToClient(ws, {
        type: 'connection_established',
        payload: { message: 'WebSocket connection established' },
        timestamp: Date.now(),
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(ws, message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  private handleClientMessage(ws: WebSocket, message: { type: string; timestamp?: number }): void {
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

  private broadcast(message: WebSocketMessage): void {
    const messageStr = JSON.stringify(message);
    const disconnectedClients: WebSocket[] = [];

    this.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      } else {
        disconnectedClients.push(ws);
      }
    });

    disconnectedClients.forEach((ws) => {
      this.clients.delete(ws);
    });
  }

  getConnectionCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.wss) {
      this.wss.close();
    }
    this.clients.clear();
  }
}
