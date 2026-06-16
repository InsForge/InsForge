import { useQuery } from '@tanstack/react-query';
import { aiService } from '#features/ai/services/ai.service';
import type { AIOverview } from '@insforge/shared-schemas';

export const AI_OVERVIEW_QUERY_KEY = ['ai-overview'] as const;

export function useAIOverview() {
  return useQuery<AIOverview>({
    queryKey: AI_OVERVIEW_QUERY_KEY,
    queryFn: () => aiService.getOverview(),
    staleTime: 60 * 1000,
    retry: false,
  });
}
