import { useQuery } from '@tanstack/react-query';
import { aiService } from '#features/ai/services/ai.service';
import type { AIOverview } from '@insforge/shared-schemas';

export function useAIOverview() {
  return useQuery<AIOverview>({
    queryKey: ['ai-overview'],
    queryFn: () => aiService.getOverview(),
    staleTime: 60 * 1000,
    retry: false,
  });
}
