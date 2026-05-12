import { useQuery } from '@tanstack/react-query';
import { aiService } from '#features/ai/services/ai.service';
import type { AIOverview } from '@insforge/shared-schemas';

export function useAIOverview(range: string) {
  return useQuery<AIOverview>({
    queryKey: ['ai-overview', range],
    queryFn: () => aiService.getOverview(range),
    staleTime: 60 * 1000,
    retry: false,
  });
}
