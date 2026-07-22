import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  ReactNode,
  useMemo,
} from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { apiClient } from '#lib/api/client';
import { useAuth } from './AuthContext';
import { getDashboardBackendUrl } from '#lib/config/runtime';
import type { SocketMessage } from '@insforge/shared-schemas';
import { databaseTableQueryKeys } from '#features/database/queryKeys';
import { parseDatabaseTableReference } from '#features/database/helpers';
import { useMcpUsage } from '#features/logs/hooks/useMcpUsage';
import { trackEvent, getFeatureFlag } from '#lib/analytics/posthog';
import { ANALYTICS_EVENTS, FEATURE_FLAGS } from '#lib/analytics/constants';

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

/**
 * Window over which realtime query invalidations are coalesced. A burst of
 * writes to the same table within this window collapses into a single refetch,
 * capping refetch rate while keeping the dashboard live (max staleness ~= this).
 */
const INVALIDATION_DEBOUNCE_MS = 300;

// ============================================================================
// Payload Types
// ============================================================================

export enum DataUpdateResourceType {
  DATABASE = 'database',
  USERS = 'users',
  BUCKETS = 'buckets',
  FUNCTIONS = 'functions',
  DEPLOYMENTS = 'deployments',
  REALTIME = 'realtime',
}

export interface DatabaseResourceUpdate {
  type:
    | 'tables'
    | 'table'
    | 'records'
    | 'index'
    | 'trigger'
    | 'policy'
    | 'function'
    | 'extension'
    | 'migration';
  name?: string;
}

// ============================================================================
// Context Types
// ============================================================================

interface SocketState {
  isConnected: boolean;
  connectionError: string | null;
  socketId: string | null;
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
  });

  // Refs
  const socketRef = useRef<Socket | null>(null);

  // Pending query invalidations from realtime events, deduped by serialized
  // key. Flushed as a single batch by flushInvalidations (see scheduleInvalidate).
  const pendingInvalidationsRef = useRef<Map<string, QueryKey>>(new Map());
  const invalidationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Update state helper
   */
  const updateState = useCallback((updates: Partial<SocketState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  /**
   * Flush all pending invalidations queued since the timer was armed. Each
   * unique query key is invalidated once, regardless of how many events touched it.
   */
  const flushInvalidations = useCallback(() => {
    invalidationTimerRef.current = null;
    const pending = pendingInvalidationsRef.current;
    if (pending.size === 0) {
      return;
    }
    const queryKeys = Array.from(pending.values());
    pending.clear();
    for (const queryKey of queryKeys) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient]);

  /**
   * Queue a query key for invalidation, coalescing keys received within
   * INVALIDATION_DEBOUNCE_MS into one flush. This throttles refetches under
   * high write volume instead of firing one per DATA_UPDATE event.
   */
  const scheduleInvalidate = useCallback(
    (queryKey: QueryKey) => {
      pendingInvalidationsRef.current.set(JSON.stringify(queryKey), queryKey);
      if (invalidationTimerRef.current === null) {
        invalidationTimerRef.current = setTimeout(flushInvalidations, INVALIDATION_DEBOUNCE_MS);
      }
    },
    [flushInvalidations]
  );

  /**
   * Create and configure socket connection
   */
  const createSocket = useCallback(
    (token: string): Socket => {
      const socket = io(getDashboardBackendUrl(), {
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
    const token = apiClient.getAccessToken();

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

  // Clear any pending invalidation timer on unmount
  useEffect(() => {
    return () => {
      if (invalidationTimerRef.current !== null) {
        clearTimeout(invalidationTimerRef.current);
        invalidationTimerRef.current = null;
      }
    };
  }, []);

  // Send onboarding success only after 2+ MCP connections
  const onMcpConnectedSuccess = useCallback(
    (toolName: string) => {
      if (mcpUsageCount === 1) {
        trackEvent(ANALYTICS_EVENTS.ONBOARDING_COMPLETED, {
          experiment_variant: getFeatureFlag(FEATURE_FLAGS.DASHBOARD_V4_EXPERIMENT),
          mcp_vs_cli_variant: getFeatureFlag(FEATURE_FLAGS.MCP_VS_CLI),
          tool_name: toolName,
        });
      }
    },
    [mcpUsageCount]
  );

  // Register business event handlers when socket is connected
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !state.isConnected) {
      return;
    }

    // Handle DATA_UPDATE events - invalidate relevant queries. Invalidations are
    // coalesced (see scheduleInvalidate) so a burst of writes to the same table
    // collapses into a single refetch instead of one per event.
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
                scheduleInvalidate(['database', 'tables']);
                scheduleInvalidate(['metadata', 'full']);
                break;
              case 'table':
                // ALTER TABLE / RENAME - affects specific table and list
                scheduleInvalidate(['database', 'tables']);
                if (change.name) {
                  const { schemaName, tableName } = parseDatabaseTableReference(change.name);
                  scheduleInvalidate(databaseTableQueryKeys.tableSchema(schemaName, tableName));
                }
                break;
              case 'records':
                // INSERT / UPDATE / DELETE - affects records for specific table
                if (change.name) {
                  const { schemaName, tableName } = parseDatabaseTableReference(change.name);
                  scheduleInvalidate(['records', schemaName, tableName]);
                }
                // Record count changed — refresh metadata so dashboard steps update
                scheduleInvalidate(['metadata', 'full']);
                break;
              case 'index':
                scheduleInvalidate(['database', 'indexes']);
                break;
              case 'trigger':
                scheduleInvalidate(['database', 'triggers']);
                break;
              case 'policy':
                scheduleInvalidate(['database', 'policies']);
                break;
              case 'function':
                scheduleInvalidate(['database', 'functions']);
                break;
              case 'extension':
                // Extensions are not supported yet
                break;
              case 'migration':
                scheduleInvalidate(['database', 'migrations']);
                break;
            }
          }
          break;
        }
        case DataUpdateResourceType.BUCKETS:
          scheduleInvalidate(['storage', 'buckets']);
          scheduleInvalidate(['metadata', 'full']);
          break;
        case DataUpdateResourceType.USERS:
          scheduleInvalidate(['users']);
          break;
        case DataUpdateResourceType.FUNCTIONS:
          scheduleInvalidate(['functions']);
          break;
        case DataUpdateResourceType.DEPLOYMENTS:
          scheduleInvalidate(['deployment-metadata']);
          break;
        case DataUpdateResourceType.REALTIME:
          scheduleInvalidate(['realtime']);
          break;
      }
    };

    // Handle MCP_CONNECTED events
    const handleMcpConnected = (message: SocketMessage) => {
      void queryClient.invalidateQueries({ queryKey: ['mcp-usage'] });

      const toolName = message.tool_name as string;

      onMcpConnectedSuccess(toolName);
    };

    socket.on(ServerEvents.DATA_UPDATE, handleDataUpdate);
    socket.on(ServerEvents.MCP_CONNECTED, handleMcpConnected);

    return () => {
      socket.off(ServerEvents.DATA_UPDATE, handleDataUpdate);
      socket.off(ServerEvents.MCP_CONNECTED, handleMcpConnected);
    };
  }, [state.isConnected, queryClient, onMcpConnectedSuccess, scheduleInvalidate]);

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
