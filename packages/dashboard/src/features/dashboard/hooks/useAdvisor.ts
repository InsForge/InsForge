import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import type {
  DashboardAdvisorCategory,
  DashboardAdvisorIssuesQuery,
  DashboardAdvisorIssuesResponse,
  DashboardAdvisorSeverity,
  DashboardAdvisorSummary,
} from '#types';

export type AdvisorCategorySeverityMatrix = Record<
  DashboardAdvisorCategory,
  Record<DashboardAdvisorSeverity, number>
>;

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

function emptyMatrix(): AdvisorCategorySeverityMatrix {
  const empty = (): Record<DashboardAdvisorSeverity, number> => ({
    critical: 0,
    warning: 0,
    info: 0,
  });
  return { security: empty(), performance: empty(), health: empty() };
}

const ADVISOR_COUNT_PAGE_SIZE = 100;

export function useAdvisorCategoryCounts() {
  const host = useDashboardHost();
  const fetcher = host.onRequestAdvisorIssues;
  return useQuery<AdvisorCategorySeverityMatrix, Error>({
    queryKey: ADVISOR_QUERY_KEYS.categoryCounts,
    queryFn: async () => {
      if (!fetcher) {
        return emptyMatrix();
      }
      const matrix = emptyMatrix();
      let offset = 0;
      while (true) {
        const page = await fetcher({ limit: ADVISOR_COUNT_PAGE_SIZE, offset });
        for (const issue of page.issues) {
          matrix[issue.category][issue.severity] += 1;
        }
        offset += page.issues.length;
        if (page.issues.length < ADVISOR_COUNT_PAGE_SIZE || offset >= page.total) {
          break;
        }
      }
      return matrix;
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
