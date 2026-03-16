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

interface UseMcpUsageOptions {
  successFilter?: boolean | null;
}

/**
 * Hook to manage MCP usage data
 *
 * Features:
 * - Fetches MCP logs from backend with server-side pagination
 * - Provides helper functions for data access
 * - Handles initial parent window notification for onboarding (if in iframe)
 * - Supports search and pagination
 *
 */
export function useMcpUsage(options: UseMcpUsageOptions = {}) {
  const { successFilter = null } = options;

  // Hooks
  const { isAuthenticated } = useAuth();

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Refs
  const hasNotifiedInitialStatus = useRef(false);

  // Debounce search to avoid a request per keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset page when search or filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, successFilter]);

  // Query to fetch one page of MCP logs from the server
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mcp-usage', successFilter, currentPage, LOGS_PAGE_SIZE, debouncedSearch],
    queryFn: () =>
      usageService.getMcpUsage(
        successFilter,
        currentPage,
        LOGS_PAGE_SIZE,
        debouncedSearch || undefined
      ),
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // Cache for 30 seconds
    refetchInterval: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  const records: McpUsageRecord[] = useMemo(() => {
    return data?.records ?? [];
  }, [data?.records]);
  const total: number = data?.total ?? 0;

  // Calculate pagination from server-reported total
  const totalPages = useMemo(() => Math.ceil(total / LOGS_PAGE_SIZE), [total]);

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
  const hasCompletedOnboarding = useMemo(() => total > 0, [total]);
  const latestRecord = useMemo(() => records[0] || null, [records]);

  return {
    // Data
    records,
    hasCompletedOnboarding,
    latestRecord,
    recordsCount: total,
    filteredRecordsCount: total,

    // Search
    searchQuery,
    setSearchQuery,

    // Pagination
    currentPage,
    setCurrentPage,
    totalPages,
    pageSize: LOGS_PAGE_SIZE,

    // Loading states
    isLoading,
    error,

    // Actions
    refetch,
  };
}
