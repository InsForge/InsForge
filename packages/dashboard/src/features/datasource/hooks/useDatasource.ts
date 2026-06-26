import { useQuery } from '@tanstack/react-query';
import { datasourceService } from '#features/datasource/services/datasource.service';

export const datasourceQueryKeys = {
  all: ['datasource'] as const,
  apifyConnection: ['datasource', 'apify', 'connection'] as const,
};

export function useApifyConnection() {
  return useQuery({
    queryKey: datasourceQueryKeys.apifyConnection,
    queryFn: () => datasourceService.getApifyConnection(),
    staleTime: 30_000,
  });
}
