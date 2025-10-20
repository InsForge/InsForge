import { useCallback, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSocket, ServerEvents } from '@/lib/contexts/SocketContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { usageService, McpUsageRecord } from '@/features/logs/services/usage.service';
import { isInsForgeCloudProject } from '@/lib/utils/utils';

// ============================================================================
// Types
// ============================================================================

export interface McpConnectedPayload {
  tool_name: string;
  created_at: string;
}

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Hook to manage MCP usage data and real-time updates
 *
 * Features:
 * - Fetches initial MCP logs from backend
 * - Listens to real-time socket updates for new MCP calls
 * - Invalidates queries on WebSocket events to refetch latest data
 * - Provides helper functions for data access
 * - Handles parent window communication for onboarding (if in iframe)
 */
export function useMcpUsage() {
  // Hooks
  const queryClient = useQueryClient();
  const { socket, isConnected } = useSocket();
  const { isAuthenticated } = useAuth();

  // Refs
  const hasNotifiedInitialStatus = useRef(false);

  // Query to fetch all MCP loss
  const {
    data: records = [],
    isLoading,
    error,
    refetch,
  } = useQuery<McpUsageRecord[]>({
    queryKey: ['mcp-usage'],
    queryFn: () => usageService.getMcpUsage(),
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // Cache for 30 seconds
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  // Notify parent window of initial onboarding status (ONLY ONCE)
  useEffect(() => {
    if (
      hasNotifiedInitialStatus.current ||
      isLoading ||
      !records.length ||
      !isInsForgeCloudProject()
    ) {
      return;
    }

    hasNotifiedInitialStatus.current = true;

    const latestRecord = records[0];
    window.parent.postMessage(
      {
        type: 'MCP_CONNECTION_STATUS',
        connected: true,
        tool_name: latestRecord.tool_name,
        timestamp: latestRecord.created_at,
      },
      '*'
    );
  }, [isLoading, records]);

  // Handle real-time MCP connection events from socket
  const handleMcpConnected = useCallback(
    (data: { id: string; payload: McpConnectedPayload; timestamp: number; type: string }) => {
      // Invalidate query to refetch latest data (follows codebase pattern)
      void queryClient.invalidateQueries({ queryKey: ['mcp-usage'] });

      // Notify parent window with latest MCP call info
      if (window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'MCP_CONNECTION_STATUS',
            connected: true,
            tool_name: data.payload.tool_name,
            timestamp: data.payload.created_at,
          },
          '*'
        );
      }
    },
    [queryClient]
  );

  // Subscribe to socket MCP connection events
  useEffect(() => {
    if (!socket || !isConnected) {
      return;
    }

    socket.on(ServerEvents.MCP_CONNECTED, handleMcpConnected);

    return () => {
      socket.off(ServerEvents.MCP_CONNECTED, handleMcpConnected);
    };
  }, [socket, isConnected, handleMcpConnected]);

  // Computed values
  const hasCompletedOnboarding = useMemo(() => !!records.length, [records]);
  const recordsCount = useMemo(() => records.length, [records]);
  const latestRecord = useMemo(() => records[0] || null, [records]);

  return {
    // Data
    records,
    hasCompletedOnboarding,
    latestRecord,
    recordsCount,

    // Loading states
    isLoading,
    error,

    // Actions
    refetch,
  };
}
