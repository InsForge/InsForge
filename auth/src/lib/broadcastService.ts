export enum BroadcastEventType {
  EMAIL_VERIFIED_SUCCESS = 'EMAIL_VERIFIED_SUCCESS',
  PASSWORD_RESET_SUCCESS = 'PASSWORD_RESET_SUCCESS',
}

export interface BroadcastEvent {
  type: BroadcastEventType;
  timestamp: number;
  data?: {
    accessToken?: string;
    code?: string; // New backend returns code instead of accessToken
    user?: { id: string; email: string; name: string };
    csrfToken?: string;
  };
}

export type BroadcastEventHandler = (event: BroadcastEvent) => void;

class BroadcastService {
  private channel: BroadcastChannel | null = null;
  private readonly CHANNEL_NAME = 'insforge-auth-channel';
  private handlers: Map<BroadcastEventType, Set<BroadcastEventHandler>> = new Map();
  private isInitialized = false;

  private isSupported(): boolean {
    return typeof window !== 'undefined' && 'BroadcastChannel' in window;
  }

  init(): void {
    if (this.isInitialized) {
      return;
    }

    if (!this.isSupported()) {
      console.warn('BroadcastChannel API is not supported in this browser');
      return;
    }

    try {
      this.channel = new BroadcastChannel(this.CHANNEL_NAME);
      this.channel.onmessage = (messageEvent: MessageEvent<BroadcastEvent>) => {
        const event = messageEvent.data;
        this.handleIncomingEvent(event);
      };
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize BroadcastService:', error);
    }
  }

  private handleIncomingEvent(event: BroadcastEvent): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          console.error('Error handling broadcast event:', error);
        }
      });
    }
  }

  subscribe(eventType: BroadcastEventType, handler: BroadcastEventHandler): () => void {
    if (!this.isInitialized) {
      this.init();
    }

    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    this.handlers.get(eventType)?.add(handler);

    return () => {
      const handlers = this.handlers.get(eventType);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }

  broadcast(eventType: BroadcastEventType, data?: BroadcastEvent['data']): void {
    if (!this.isInitialized) {
      this.init();
    }

    if (!this.channel) {
      console.warn('BroadcastChannel not available, cannot broadcast event');
      return;
    }

    const event: BroadcastEvent = {
      type: eventType,
      timestamp: Date.now(),
      data,
    };

    try {
      this.channel.postMessage(event);
    } catch (error) {
      console.error('Failed to broadcast event:', error);
    }
  }

  close(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.handlers.clear();
    this.isInitialized = false;
  }
}

const broadcastService = new BroadcastService();
export default broadcastService;
