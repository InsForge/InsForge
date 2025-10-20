import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { logService } from '../services/log.service';
import type { LogSourceSchema } from '@insforge/shared-schemas';

export function useLogSources() {
  const [selectedSource, setSelectedSource] = useState<string | null>(() => {
    return localStorage.getItem('selectedLogSource');
  });

  // Fetch log sources
  const {
    data: sources,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['log-sources'],
    queryFn: () => logService.getLogSources(),
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
  });

  // Fetch log source stats
  const {
    data: stats,
    isLoading: isLoadingStats,
    error: statsError,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['log-source-stats'],
    queryFn: () => logService.getLogSourceStats(),
    staleTime: 30 * 1000, // Cache for 30 seconds
  });

  // Extract source names
  const sourceNames = useMemo(() => sources?.map((s) => s.name) || [], [sources]);

  // Persist selected source to localStorage
  useEffect(() => {
    if (selectedSource) {
      localStorage.setItem('selectedLogSource', selectedSource);
    } else {
      localStorage.removeItem('selectedLogSource');
    }
  }, [selectedSource]);

  // Auto-select first source or validate current selection
  useEffect(() => {
    if (!isLoading && sources && sources.length) {
      // If no source selected or selected source doesn't exist (except 'MCP logs'), select first one
      if (
        !selectedSource ||
        (selectedSource !== 'MCP' && !sources.some((s) => s.name === selectedSource))
      ) {
        setSelectedSource(sources[0].name);
      }
    }
  }, [sources, isLoading, selectedSource]);

  // Select source handler
  const selectSource = useCallback((sourceName: string) => {
    setSelectedSource(sourceName);
  }, []);

  // Clear selection handler
  const clearSelection = useCallback(() => {
    setSelectedSource(null);
  }, []);

  // Get source by name
  const getSourceByName = useCallback(
    (name: string): LogSourceSchema | undefined => {
      return sources?.find((s) => s.name === name);
    },
    [sources]
  );

  // Get stats for a specific source
  const getStatsForSource = useCallback(
    (sourceName: string) => {
      return stats?.find((s) => s.source === sourceName);
    },
    [stats]
  );

  // Refresh all data
  const refreshAll = useCallback(async () => {
    await Promise.all([refetch(), refetchStats()]);
  }, [refetch, refetchStats]);

  return {
    // Data
    sources: sources || [],
    sourceNames,
    sourcesCount: sources?.length || 0,
    selectedSource,
    stats: stats || [],

    // Loading states
    isLoading,
    isLoadingStats,

    // Errors
    error,
    statsError,

    // Actions
    selectSource,
    clearSelection,
    refetch,
    refetchStats,
    refreshAll,

    // Helpers
    getSourceByName,
    getStatsForSource,
  };
}
