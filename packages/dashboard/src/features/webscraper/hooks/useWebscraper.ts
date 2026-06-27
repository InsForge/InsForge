import { useQuery } from '@tanstack/react-query';
import { webscraperService } from '#features/webscraper/services/webscraper.service';

export const webscraperQueryKeys = {
  all: ['webscraper'] as const,
  apifyConnection: ['webscraper', 'apify', 'connection'] as const,
  apifyActors: ['webscraper', 'apify', 'actors'] as const,
  apifyDatasets: ['webscraper', 'apify', 'datasets'] as const,
  apifyRuns: ['webscraper', 'apify', 'runs'] as const,
  apifyData: ['webscraper', 'apify', 'data'] as const,
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

export function useApifyRuns(enabled: boolean, limit = 200) {
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
