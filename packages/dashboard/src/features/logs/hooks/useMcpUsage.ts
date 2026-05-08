import { useMemo, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '#lib/contexts/AuthContext';
import { usageService, McpUsageRecord } from '#features/logs/services/usage.service';
import { LOGS_PAGE_SIZE } from '#features/logs/helpers';

// ============================================================================
// Main Hook
// ============================================================================

interface UseMcpUsageOptions {
  successFilter?: boolean | null;
  limit?: number;
  pageSize?: number;
}

/**
 * Hook to manage MCP usage data
 *
 * Features:
 * - Fetches MCP logs from backend
 * - Provides helper functions for data access
 * - Supports search and pagination
 *
 */
export function useMcpUsage(options: UseMcpUsageOptions = {}) {
  const { successFilter = true, limit = 200, pageSize = LOGS_PAGE_SIZE } = options;

  // Hooks
  const { isAuthenticated } = useAuth();

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Query to fetch all MCP logs
  const {
    data: records = [],
    isLoading,
    error,
    refetch,
  } = useQuery<McpUsageRecord[]>({
    queryKey: ['mcp-usage', successFilter, limit],
    queryFn: () => usageService.getMcpUsage(successFilter, limit),
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
  }, [searchQuery, pageSize]);

  // Calculate pagination
  const totalPages = useMemo(
    () => Math.ceil(filteredRecords.length / pageSize),
    [filteredRecords.length, pageSize]
  );
  const startIndex = useMemo(() => (currentPage - 1) * pageSize, [currentPage, pageSize]);
  const endIndex = useMemo(() => startIndex + pageSize, [startIndex, pageSize]);
  const paginatedRecords = useMemo(
    () => filteredRecords.slice(startIndex, endIndex),
    [filteredRecords, startIndex, endIndex]
  );

  // Computed values
  const hasCompletedOnboarding = useMemo(() => !!records.length, [records]);
  const recordsCount = useMemo(() => records.length, [records]);
  const filteredRecordsCount = useMemo(() => filteredRecords.length, [filteredRecords.length]);
  const latestRecord = useMemo(() => records[0] || null, [records]);

  return {
    // Data
    records: paginatedRecords,
    allRecords: records,
    filteredRecords,
    hasCompletedOnboarding,
    latestRecord,
    recordsCount,
    filteredRecordsCount,

    // Search
    searchQuery,
    setSearchQuery,

    // Pagination
    currentPage,
    setCurrentPage,
    totalPages,
    pageSize,

    // Loading states
    isLoading,
    error,

    // Actions
    refetch,
  };
}
