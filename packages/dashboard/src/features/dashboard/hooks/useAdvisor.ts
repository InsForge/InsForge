import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDashboardHost } from '../../../lib/config/DashboardHostContext';
import type {
  DashboardAdvisorCategory,
  DashboardAdvisorIssuesQuery,
  DashboardAdvisorIssuesResponse,
  DashboardAdvisorSummary,
} from '../../../types';

export const ADVISOR_QUERY_KEYS = {
  latest: ['advisor', 'latest'] as const,
  issues: (q: DashboardAdvisorIssuesQuery) =>
    [
      'advisor',
      'issues',
      q.severity ?? 'all',
      q.category ?? 'all',
      q.limit ?? 50,
      q.offset ?? 0,
    ] as const,
  categoryCounts: ['advisor', 'category-counts'] as const,
};

export function useAdvisorLatest() {
  const host = useDashboardHost();
  const fetcher = host.onRequestAdvisorLatest;
  return useQuery<DashboardAdvisorSummary | null, Error>({
    queryKey: ADVISOR_QUERY_KEYS.latest,
    queryFn: () => (fetcher ? fetcher() : Promise.resolve(null)),
    enabled: !!fetcher,
    retry: false,
    staleTime: 60 * 1000,
  });
}

export function useAdvisorIssues(query: DashboardAdvisorIssuesQuery) {
  const host = useDashboardHost();
  const fetcher = host.onRequestAdvisorIssues;
  return useQuery<DashboardAdvisorIssuesResponse, Error>({
    queryKey: ADVISOR_QUERY_KEYS.issues(query),
    queryFn: () => (fetcher ? fetcher(query) : Promise.resolve({ issues: [], total: 0 })),
    enabled: !!fetcher,
    retry: false,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useAdvisorCategoryCounts() {
  const host = useDashboardHost();
  const fetcher = host.onRequestAdvisorIssues;
  return useQuery<Record<DashboardAdvisorCategory, number>, Error>({
    queryKey: ADVISOR_QUERY_KEYS.categoryCounts,
    queryFn: async () => {
      if (!fetcher) {
        return { security: 0, performance: 0, health: 0 };
      }
      const [security, performance, health] = await Promise.all([
        fetcher({ category: 'security', limit: 1 }),
        fetcher({ category: 'performance', limit: 1 }),
        fetcher({ category: 'health', limit: 1 }),
      ]);
      return {
        security: security.total,
        performance: performance.total,
        health: health.total,
      };
    },
    enabled: !!fetcher,
    retry: false,
    staleTime: 60 * 1000,
  });
}

export function useTriggerAdvisorScan() {
  const host = useDashboardHost();
  const trigger = host.onTriggerAdvisorScan;
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => (trigger ? trigger() : Promise.reject(new Error('Scan unavailable'))),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['advisor'] });
    },
  });
}
