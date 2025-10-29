/**
 * Broadcast event types for cross-tab communication
 */
export enum BroadcastEventType {
  EMAIL_VERIFIED_SUCCESS = 'EMAIL_VERIFIED_SUCCESS',
  PASSWORD_RESET_SUCCESS = 'PASSWORD_RESET_SUCCESS',
}

/**
 * Structure of a broadcast event message
 */
export interface BroadcastEvent {
  type: BroadcastEventType;
  timestamp: number;
  data?: {
    accessToken?: string;
    userId?: string;
    email?: string;
    [key: string]: unknown;
  };
}

/**
 * Handler function type for broadcast events
 */
export type BroadcastEventHandler = (event: BroadcastEvent) => void;

/**
 * BroadcastService - Handles cross-tab communication using the Broadcast Channel API
 *
 * This service enables different browser tabs/windows to communicate with each other
 * for synchronizing important events like authentication state changes, password resets,
 * and email verifications.
 */
class BroadcastService {
  private channel: BroadcastChannel | null = null;
  private readonly CHANNEL_NAME = 'insforge-auth-channel';
  private handlers: Map<BroadcastEventType, Set<BroadcastEventHandler>> = new Map();
  private isInitialized = false;

  /**
   * Check if the browser supports the Broadcast Channel API
   */
  private isSupported(): boolean {
    return typeof window !== 'undefined' && 'BroadcastChannel' in window;
  }

  /**
   * Initialize the broadcast channel for cross-tab communication
   */
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

  /**
   * Handle incoming broadcast events by calling all registered handlers
   */
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

  /**
   * Subscribe to a specific event type
   * @param eventType - The type of event to listen for
   * @param handler - Callback function to handle the event
   * @returns Unsubscribe function to remove the handler
   */
  subscribe(eventType: BroadcastEventType, handler: BroadcastEventHandler): () => void {
    if (!this.isInitialized) {
      this.init();
    }

    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    this.handlers.get(eventType)?.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(eventType);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }

  /**
   * Broadcast an event to all other tabs
   * @param eventType - The type of event to broadcast
   * @param data - Optional data to send with the event
   */
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

  /**
   * Close the broadcast channel and cleanup resources
   */
  close(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.handlers.clear();
    this.isInitialized = false;
  }
}

// Export singleton instance
const broadcastService = new BroadcastService();

export default broadcastService;
