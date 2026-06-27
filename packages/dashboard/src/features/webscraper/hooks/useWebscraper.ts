import { useQuery } from '@tanstack/react-query';
import { webscraperService } from '#features/webscraper/services/webscraper.service';

export const webscraperQueryKeys = {
  all: ['webscraper'] as const,
  apifyConnection: ['webscraper', 'apify', 'connection'] as const,
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

export function useApifyRuns(enabled: boolean) {
  return useQuery({
    queryKey: webscraperQueryKeys.apifyRuns,
    queryFn: () => webscraperService.getApifyRuns(10),
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
