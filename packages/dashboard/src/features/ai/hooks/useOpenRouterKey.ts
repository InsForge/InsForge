import { useQuery } from '@tanstack/react-query';
import { aiService } from '#features/ai/services/ai.service';
import type { OpenRouterKey } from '@insforge/shared-schemas';

export function useOpenRouterKey() {
  return useQuery<OpenRouterKey>({
    queryKey: ['openrouter-key'],
    queryFn: () => aiService.getProviderApiKey('openrouter'),
    staleTime: 60 * 1000,
    retry: false,
  });
}
