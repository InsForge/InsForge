import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { webscraperService } from '#features/webscraper/services/webscraper.service';

export const webscraperQueryKeys = {
  all: ['webscraper'] as const,
  apifyConnection: ['webscraper', 'apify', 'connection'] as const,
  apifyActors: ['webscraper', 'apify', 'actors'] as const,
  apifyDatasets: ['webscraper', 'apify', 'datasets'] as const,
  apifyRuns: ['webscraper', 'apify', 'runs'] as const,
  apifyData: ['webscraper', 'apify', 'data'] as const,
  apifyConfig: ['webscraper', 'apify', 'config'] as const,
};

export function useApifyConnection() {
  return useQuery({
    queryKey: webscraperQueryKeys.apifyConnection,
    queryFn: () => webscraperService.getApifyConnection(),
    staleTime: 30_000,
  });
}

export function useApifyActors(enabled: boolean, limit = 100) {
  return useQuery({
    queryKey: [...webscraperQueryKeys.apifyActors, limit],
    queryFn: () => webscraperService.getApifyActors(limit),
    enabled,
    staleTime: 30_000,
  });
}

export function useApifyDatasets(enabled: boolean, limit = 100) {
  return useQuery({
    queryKey: [...webscraperQueryKeys.apifyDatasets, limit],
    queryFn: () => webscraperService.getApifyDatasets(limit),
    enabled,
    staleTime: 30_000,
  });
}

export function useApifyRuns(enabled: boolean, limit = 100) {
  return useQuery({
    queryKey: [...webscraperQueryKeys.apifyRuns, limit],
    queryFn: () => webscraperService.getApifyRuns(limit),
    enabled,
    staleTime: 30_000,
  });
}

export function useApifyLatestData(enabled: boolean) {
  return useQuery({
    queryKey: webscraperQueryKeys.apifyData,
    queryFn: () => webscraperService.getApifyLatestData(5),
    enabled,
    staleTime: 60_000,
  });
}

export function useApifyConfig(enabled: boolean) {
  return useQuery({
    queryKey: webscraperQueryKeys.apifyConfig,
    queryFn: () => webscraperService.getApifyConfig(),
    enabled,
    staleTime: 30_000,
  });
}

export function useUpdateApifyConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (apiToken: string) => webscraperService.updateApifyConfig(apiToken),
    onSuccess: () => {
      // The connection is derived from the token, so both have to refetch.
      void queryClient.invalidateQueries({ queryKey: webscraperQueryKeys.apifyConfig });
      void queryClient.invalidateQueries({ queryKey: webscraperQueryKeys.apifyConnection });
    },
  });
}
