import { useQuery } from '@tanstack/react-query';
import { datasourceService } from '#features/datasource/services/datasource.service';

export const datasourceQueryKeys = {
  all: ['datasource'] as const,
  apifyConnection: ['datasource', 'apify', 'connection'] as const,
  apifyRuns: ['datasource', 'apify', 'runs'] as const,
  apifyData: ['datasource', 'apify', 'data'] as const,
};

export function useApifyConnection() {
  return useQuery({
    queryKey: datasourceQueryKeys.apifyConnection,
    queryFn: () => datasourceService.getApifyConnection(),
    staleTime: 30_000,
  });
}

export function useApifyRuns(enabled: boolean) {
  return useQuery({
    queryKey: datasourceQueryKeys.apifyRuns,
    queryFn: () => datasourceService.getApifyRuns(10),
    enabled,
    staleTime: 30_000,
  });
}

export function useApifyLatestData(enabled: boolean) {
  return useQuery({
    queryKey: datasourceQueryKeys.apifyData,
    queryFn: () => datasourceService.getApifyLatestData(5),
    enabled,
    staleTime: 60_000,
  });
}
