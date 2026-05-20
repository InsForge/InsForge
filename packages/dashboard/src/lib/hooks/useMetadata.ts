import { useQuery } from '@tanstack/react-query';
import { metadataService } from '#lib/services/metadata.service';

interface UseMetadataOptions {
  enabled?: boolean;
  staleTime?: number;
}

export function useMetadata(options?: UseMetadataOptions) {
  const {
    data: metadata,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['metadata', 'full'],
    queryFn: ({ signal }) => metadataService.getFullMetadata(signal),
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // Cache for 5 minutes by default
    gcTime: Infinity, // Never garbage-collect: cached metadata survives navigation
    // away from /dashboard so returning to it doesn't trigger a cold skeleton/
    // empty-metric-card render while the fetch is in flight.
    enabled: options?.enabled ?? true,
  });

  return {
    metadata,
    auth: metadata?.auth,
    tables: metadata?.database.tables,
    storage: metadata?.storage,
    version: metadata?.version || 'Unknown',
    isLoading,
    error,
    refetch,
  };
}

export function useApiKey(options?: UseMetadataOptions) {
  const {
    data: apiKey,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['metadata', 'apiKey'],
    queryFn: ({ signal }) => metadataService.fetchApiKey(signal),
    staleTime: options?.staleTime ?? 10 * 60 * 1000, // Cache for 10 minutes by default
    enabled: options?.enabled ?? true,
  });

  return {
    apiKey,
    isLoading,
    error,
    refetch,
  };
}

export function useProjectId(options?: UseMetadataOptions) {
  const {
    data: projectId,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['metadata', 'projectId'],
    queryFn: ({ signal }) => metadataService.fetchProjectId(signal),
    staleTime: options?.staleTime ?? 10 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });

  return {
    projectId,
    isLoading,
    error,
    refetch,
  };
}

export function useDatabaseConnectionString(options?: UseMetadataOptions) {
  const {
    data: connectionData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['metadata', 'databaseConnectionString'],
    queryFn: ({ signal }) => metadataService.getDatabaseConnectionString(signal),
    staleTime: 0,
    gcTime: 0,
    enabled: options?.enabled ?? true,
  });

  return {
    connectionData,
    isLoading,
    error,
    refetch,
  };
}

export function useDatabasePassword(options?: UseMetadataOptions) {
  const {
    data: passwordData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['metadata', 'databasePassword'],
    queryFn: ({ signal }) => metadataService.getDatabasePassword(signal),
    staleTime: 0,
    gcTime: 0,
    enabled: options?.enabled ?? true,
  });

  return {
    passwordData,
    isLoading,
    error,
    refetch,
  };
}
