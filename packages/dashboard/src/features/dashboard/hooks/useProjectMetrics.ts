import { useQuery } from '@tanstack/react-query';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import type { DashboardMetricsRange, DashboardMetricsResponse } from '#types';

export const PROJECT_METRICS_QUERY_KEY = 'project-metrics';

export interface UseProjectMetricsResult {
  data?: DashboardMetricsResponse;
  isLoading: boolean;
  isFetching: boolean;
  isUnavailable: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useProjectMetrics(range: DashboardMetricsRange): UseProjectMetricsResult {
  const host = useDashboardHost();
  const fetcher = host.onRequestProjectMetrics;

  const query = useQuery<DashboardMetricsResponse, Error>({
    queryKey: [PROJECT_METRICS_QUERY_KEY, range],
    queryFn: () => {
      if (!fetcher) {
        return Promise.reject(new Error('METRICS_UNAVAILABLE'));
      }
      return fetcher(range);
    },
    enabled: !!fetcher,
    retry: false,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  });

  const isUnavailable = !fetcher || query.error?.message === 'METRICS_UNAVAILABLE';

  return {
    data: query.data,
    isLoading: query.isLoading && !!fetcher,
    isFetching: query.isFetching && !!fetcher,
    isUnavailable,
    error: isUnavailable ? null : (query.error as Error | null),
    refetch: async () => {
      await query.refetch();
    },
  };
}
