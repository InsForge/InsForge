import { useQuery } from '@tanstack/react-query';
import { useDashboardHost } from '../../../lib/config/DashboardHostContext';
import type { DashboardMetricsRange, DashboardMetricsResponse } from '../../../types';

export const PROJECT_METRICS_QUERY_KEY = 'project-metrics';

export interface UseProjectMetricsResult {
  data?: DashboardMetricsResponse;
  isLoading: boolean;
  isUnavailable: boolean;
  error: Error | null;
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
    staleTime: 60 * 1000,
  });

  const isUnavailable = !fetcher || query.error?.message === 'METRICS_UNAVAILABLE';

  return {
    data: query.data,
    isLoading: query.isLoading && !!fetcher,
    isUnavailable,
    error: isUnavailable ? null : (query.error as Error | null),
  };
}
