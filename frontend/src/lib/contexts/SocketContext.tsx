import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useCallback,
  ReactNode,
  useMemo,
} from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/contexts/AuthContext';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';
import type { SocketMessage } from '@insforge/shared-schemas';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';

// ============================================================================
// Types & Enums
// ============================================================================

/**
 * Server-to-client event types
 */
export enum ServerEvents {
  NOTIFICATION = 'notification',
  DATA_UPDATE = 'data:update',
  MCP_CONNECTED = 'mcp:connected',
}

// ============================================================================
// Payload Types
// ============================================================================

export enum DataUpdateResourceType {
  DATABASE = 'database',
  USERS = 'users',
  BUCKETS = 'buckets',
  FUNCTIONS = 'functions',
  REALTIME = 'realtime',
}

export interface DatabaseResourceUpdate {
  type: 'tables' | 'table' | 'records' | 'index' | 'trigger' | 'policy' | 'function' | 'extension';
  name?: string;
}

// ============================================================================
// Context Types
// ============================================================================

interface SocketState {
  isConnected: boolean;
  connectionError: string | null;
  socketId: string | null;
  lastMcpConnectionTimestamp: number | null;
}

interface SocketActions {
  connect: (token: string | null) => void;
  disconnect: () => void;
}

interface SocketContextValue extends SocketState, SocketActions {
  socket: Socket | null;
}

// ============================================================================
// Context & Provider
// ============================================================================

const SocketContext = createContext<SocketContextValue | null>(null);

interface SocketProviderProps {
  children: ReactNode;
}

/**
 * Socket.IO Provider - Manages WebSocket connection for the entire application
 */
export function SocketProvider({ children }: SocketProviderProps) {
  // Get authentication state
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const { recordsCount: mcpUsageCount } = useMcpUsage();

  // State
  const [state, setState] = useState<SocketState>({
    isConnected: false,
    connectionError: null,
    socketId: null,
    lastMcpConnectionTimestamp: null,
  });

  // Refs
  const socketRef = useRef<Socket | null>(null);

  /**
   * Update state helper
   */
  const updateState = useCallback((updates: Partial<SocketState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  /**
   * Create and configure socket connection
   */
  const createSocket = useCallback(
    (token: string): Socket => {
      const socket = io('/', {
        auth: {
          token,
        },
      });

      // Core connection events
      socket.on('connect', () => {
        updateState({
          isConnected: true,
          connectionError: null,
          socketId: socket.id || null,
        });
      });

      socket.on('disconnect', (reason) => {
        updateState({
          isConnected: false,
          socketId: null,
          connectionError: `Disconnected: ${reason}`,
        });
      });

      socket.on('connect_error', (error) => {
        updateState({
          connectionError: `Connection failed: ${error.message}`,
          isConnected: false,
        });
      });

      socket.on('error', (error) => {
        updateState({ connectionError: error?.message || 'Unknown error' });
      });

      socket.on('reconnect', () => {
        updateState({
          isConnected: true,
          connectionError: null,
        });
      });

      return socket;
    },
    [updateState]
  );

  /**
   * Connect to socket server
   */
  const connect = useCallback(
    (token: string | null) => {
      // Don't connect without a token
      if (!token) {
        return;
      }

      // Don't reconnect if already connected with the same token
      if (socketRef.current?.connected) {
        return;
      }

      try {
        const socket = createSocket(token);
        socketRef.current = socket;
      } catch (error) {
        console.error('Socket connection error:', error);
        updateState({ connectionError: 'Failed to establish connection' });
      }
    },
    [createSocket, updateState]
  );

  /**
   * Disconnect from socket server
   */
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    updateState({
      isConnected: false,
      connectionError: null,
      socketId: null,
    });
  }, [updateState]);

  // Monitor authentication state and token changes
  useEffect(() => {
    const token = apiClient.getToken();

    if (isAuthenticated && token) {
      // Connect when authenticated with a valid token
      connect(token);
    } else {
      // Disconnect when not authenticated or no token
      disconnect();
    }
  }, [isAuthenticated, connect, disconnect]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // Send onboarding success only on first MCP connection
  const onMcpConnectedSuccess = useEffectEvent(() => {
    if (mcpUsageCount === 0) {
      postMessageToParent({ type: 'ONBOARDING_SUCCESS' });
    }
  });

  // Register business event handlers when socket is connected
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !state.isConnected) {
      return;
    }

    // Handle DATA_UPDATE events - invalidate relevant queries
    const handleDataUpdate = (message: SocketMessage) => {
      const resource = message.resource as DataUpdateResourceType;

      switch (resource) {
        case DataUpdateResourceType.DATABASE: {
          const { changes } = (message.data ?? {}) as { changes?: DatabaseResourceUpdate[] };

          if (!changes || changes.length === 0) {
            break;
          }

          // Invalidate specific queries based on resource types changed
          for (const change of changes) {
            switch (change.type) {
              case 'tables':
                // CREATE TABLE / DROP TABLE - affects table list
                void queryClient.invalidateQueries({ queryKey: ['tables'] });
                void queryClient.invalidateQueries({ queryKey: ['metadata', 'full'] });
                break;
              case 'table':
                // ALTER TABLE / RENAME - affects specific table and list
                void queryClient.invalidateQueries({ queryKey: ['tables'] });
                if (change.name) {
                  void queryClient.invalidateQueries({ queryKey: ['table', change.name] });
                }
                break;
              case 'records':
                // INSERT / UPDATE / DELETE - affects records for specific table
                if (change.name) {
                  void queryClient.invalidateQueries({ queryKey: ['records', change.name] });
                }
                break;
              case 'index':
                void queryClient.invalidateQueries({ queryKey: ['database', 'indexes'] });
                break;
              case 'trigger':
                void queryClient.invalidateQueries({ queryKey: ['database', 'triggers'] });
                break;
              case 'policy':
                void queryClient.invalidateQueries({ queryKey: ['database', 'policies'] });
                break;
              case 'function':
                void queryClient.invalidateQueries({ queryKey: ['database', 'functions'] });
                break;
              case 'extension':
                // Extensions are not supported yet
                break;
            }
          }
          break;
        }
        case DataUpdateResourceType.BUCKETS:
          void queryClient.invalidateQueries({ queryKey: ['storage', 'buckets'] });
          void queryClient.invalidateQueries({ queryKey: ['metadata', 'full'] });
          break;
        case DataUpdateResourceType.USERS:
          void queryClient.invalidateQueries({ queryKey: ['users'] });
          break;
        case DataUpdateResourceType.FUNCTIONS:
          void queryClient.invalidateQueries({ queryKey: ['functions'] });
          break;
        case DataUpdateResourceType.REALTIME:
          void queryClient.invalidateQueries({ queryKey: ['realtime'] });
          break;
      }
    };

    // Handle MCP_CONNECTED events
    const handleMcpConnected = (message: SocketMessage) => {
      void queryClient.invalidateQueries({ queryKey: ['mcp-usage'] });

      // Update timestamp to trigger onboarding modal close
      updateState({ lastMcpConnectionTimestamp: Date.now() });

      // Notify parent window (for cloud onboarding)
      postMessageToParent({
        type: 'MCP_CONNECTION_STATUS',
        connected: true,
        tool_name: message.tool_name as string,
        timestamp: message.created_at as string,
      });

      onMcpConnectedSuccess();
    };

    socket.on(ServerEvents.DATA_UPDATE, handleDataUpdate);
    socket.on(ServerEvents.MCP_CONNECTED, handleMcpConnected);

    return () => {
      socket.off(ServerEvents.DATA_UPDATE, handleDataUpdate);
      socket.off(ServerEvents.MCP_CONNECTED, handleMcpConnected);
    };
  }, [state.isConnected, queryClient]);

  // Context value
  const contextValue = useMemo<SocketContextValue>(
    () => ({
      // State
      socket: socketRef.current,
      ...state,
      // Actions
      connect,
      disconnect,
    }),
    [state, connect, disconnect]
  );

  return <SocketContext.Provider value={contextValue}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocketContext must be used within a SocketProvider');
  }
  return context;
}
