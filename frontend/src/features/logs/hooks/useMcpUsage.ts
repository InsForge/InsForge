import { useMemo, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/contexts/AuthContext';
import { usageService, McpUsageRecord } from '@/features/logs/services/usage.service';
import { isInsForgeCloudProject } from '@/lib/utils/utils';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';
import { LOGS_PAGE_SIZE } from '../helpers';

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Hook to manage MCP usage data
 *
 * Features:
 * - Fetches MCP logs from backend
 * - Provides helper functions for data access
 * - Handles initial parent window notification for onboarding (if in iframe)
 * - Supports search and pagination
 *
 */
export function useMcpUsage() {
  // Hooks
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
    postMessageToParent({
      type: 'MCP_CONNECTION_STATUS',
      connected: true,
      tool_name: latestRecord.tool_name,
      timestamp: latestRecord.created_at,
    });
  }, [isLoading, records]);

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
