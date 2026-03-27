import { useQuery } from '@tanstack/react-query';
import { healthService } from '../services/health.service';

interface UseHealthOptions {
  enabled?: boolean;
  staleTime?: number;
}

export function useHealth(options?: UseHealthOptions) {
  const {
    data: health,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['health'],
    queryFn: () => healthService.getHealth(),
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // Cache for 5 minutes by default
    enabled: options?.enabled ?? true,
  });

  return {
    health,
    version: health?.version ? `v${health.version}` : undefined,
    status: health?.status,
    isLoading,
    error,
    refetch,
  };
}
