import { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSocket, ServerEvents } from '@/lib/contexts/SocketContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { usageService, McpUsageRecord } from '@/features/logs/services/usage.service';
import { isInsForgeCloudProject } from '@/lib/utils/utils';
import { LOGS_PAGE_SIZE } from '../helpers';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';

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
 * - Supports search and pagination
 */
export function useMcpUsage() {
  // Hooks
  const queryClient = useQueryClient();
  const { socket, isConnected } = useSocket();
  const { isAuthenticated } = useAuth();

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Refs
  const hasNotifiedInitialStatus = useRef(false);

  // Query to fetch all MCP logs
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

  // Filter records by search query
  const filteredRecords = useMemo(() => {
    if (!searchQuery) {
      return records;
    }
    return records.filter((record) =>
      record.tool_name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [records, searchQuery]);

  // Reset page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Calculate pagination
  const totalPages = useMemo(
    () => Math.ceil(filteredRecords.length / LOGS_PAGE_SIZE),
    [filteredRecords.length]
  );
  const startIndex = useMemo(() => (currentPage - 1) * LOGS_PAGE_SIZE, [currentPage]);
  const endIndex = useMemo(() => startIndex + LOGS_PAGE_SIZE, [startIndex]);
  const paginatedRecords = useMemo(
    () => filteredRecords.slice(startIndex, endIndex),
    [filteredRecords, startIndex, endIndex]
  );

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
        if (!records.length) {
          postMessageToParent({ type: 'ONBOARDING_SUCCESS' });
        }
      }
      // Invalidate query to refetch latest data (follows codebase pattern)
      void queryClient.invalidateQueries({ queryKey: ['mcp-usage'] });
    },
    [queryClient, records.length]
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
    records: paginatedRecords,
    allRecords: records,
    filteredRecords,
    hasCompletedOnboarding,
    latestRecord,
    recordsCount,

    // Search
    searchQuery,
    setSearchQuery,

    // Pagination
    currentPage,
    setCurrentPage,
    totalPages,

    // Loading states
    isLoading,
    error,

    // Actions
    refetch,
  };
}
