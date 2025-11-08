import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { logService } from '../services/log.service';
import type { LogSchema } from '@insforge/shared-schemas';
import { LOGS_PAGE_SIZE, SeverityType } from '../helpers';

const FETCH_SIZE = 200;

export function useLogs(source: string) {
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string[]>([
    'error',
    'warning',
    'informational',
  ]);
  const [loadedLogs, setLoadedLogs] = useState<LogSchema[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch initial logs
  const {
    data: initialLogsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['logs-content', source],
    queryFn: async () => {
      const data = await logService.getLogsBySource(source, FETCH_SIZE);
      return {
        logs: data.logs || [],
        total: data.total || 0,
      };
    },
    enabled: !!source,
    staleTime: 0,
  });

  // Update loaded logs when data changes
  useEffect(() => {
    if (initialLogsData?.logs !== undefined) {
      // Reverse logs to show most recent first (backend returns oldest first)
      setLoadedLogs([...initialLogsData.logs].reverse());
      setHasMore(initialLogsData.logs.length === FETCH_SIZE);
      setIsLoadingMore(false);
    }
  }, [initialLogsData]);

  // Reset page when search, severity filter, or source changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, severityFilter, source]);

  // Load more older logs
  const loadMoreLogs = useCallback(async () => {
    if (!source || !hasMore || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    try {
      // Get the oldest log's timestamp (last in the array since we reverse)
      const oldestTimestamp = loadedLogs.length
        ? loadedLogs[loadedLogs.length - 1]?.timestamp
        : undefined;
      const data = await logService.getLogsBySource(source, FETCH_SIZE, oldestTimestamp);

      if (data.logs && data.logs.length) {
        // Reverse and append to the end (older logs)
        setLoadedLogs((prev) => [...prev, ...[...data.logs].reverse()]);
        setHasMore(data.logs.length === FETCH_SIZE);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error('Failed to load more logs:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [source, loadedLogs, hasMore, isLoadingMore]);

  // Get severity from log
  const getSeverity = useCallback((log: LogSchema): SeverityType => {
    // Parse from log.body.metadata.level set by Vector
    const metadata = log.body?.metadata as { level?: string } | undefined;
    const level = metadata?.level;
    if (!level) {
      return 'informational';
    }

    const levelLower = level.toLowerCase();

    if (levelLower === 'error') {
      return 'error';
    }
    if (levelLower === 'warning' || levelLower === 'warn') {
      return 'warning';
    }
    // 'info', 'log', and anything else defaults to informational
    return 'informational';
  }, []);

  // Filter logs by search and severity
  const filteredLogs = useMemo(() => {
    return loadedLogs.filter((log) => {
      const matchesSearch =
        !searchQuery ||
        log.eventMessage.toLowerCase().includes(searchQuery.toLowerCase()) ||
        JSON.stringify(log.body).toLowerCase().includes(searchQuery.toLowerCase());

      const matchesSeverity = !severityFilter.length || severityFilter.includes(getSeverity(log));

      return matchesSearch && matchesSeverity;
    });
  }, [loadedLogs, searchQuery, severityFilter, getSeverity]);

  // Calculate pagination
  const totalPages = useMemo(
    () => Math.ceil(filteredLogs.length / LOGS_PAGE_SIZE),
    [filteredLogs.length]
  );
  const startIndex = useMemo(() => (currentPage - 1) * LOGS_PAGE_SIZE, [currentPage]);
  const endIndex = useMemo(() => startIndex + LOGS_PAGE_SIZE, [startIndex]);
  const paginatedLogs = useMemo(
    () => filteredLogs.slice(startIndex, endIndex),
    [filteredLogs, startIndex, endIndex]
  );

  return {
    // Data
    logs: paginatedLogs,
    allLogs: loadedLogs,
    filteredLogs,
    totalLogs: filteredLogs.length,

    // Filters
    searchQuery,
    setSearchQuery,
    severityFilter,
    setSeverityFilter,

    // Pagination
    currentPage,
    setCurrentPage,
    totalPages,
    startIndex,
    endIndex,

    // Loading states
    isLoading,
    isLoadingMore,
    hasMore,

    // Error
    error,

    // Actions
    loadMoreLogs,
    refetch,
    getSeverity,
  };
}
