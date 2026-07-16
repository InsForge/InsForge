import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { aiService } from '#features/ai/services/ai.service';
import { AI_OVERVIEW_QUERY_KEY } from '#features/ai/hooks/useAIOverview';
import { useToast } from '@insforge/ui';
import type { OpenRouterKey } from '@insforge/shared-schemas';

export const OPENROUTER_KEY_QUERY_KEY = ['openrouter-key'] as const;

export function useOpenRouterKey() {
  return useQuery<OpenRouterKey>({
    queryKey: OPENROUTER_KEY_QUERY_KEY,
    queryFn: () => aiService.getProviderApiKey('openrouter'),
    staleTime: 60 * 1000,
    retry: false,
  });
}

export function useRotateOpenRouterKey() {
  const { t } = useTranslation('chrome');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation<OpenRouterKey, Error>({
    mutationFn: () => aiService.rotateProviderApiKey('openrouter'),
    onSuccess: (key) => {
      queryClient.setQueryData(OPENROUTER_KEY_QUERY_KEY, key);
      void queryClient.invalidateQueries({ queryKey: AI_OVERVIEW_QUERY_KEY });
      showToast(
        t('ai.overview.keyRotated', { defaultValue: 'OpenRouter API key rotated successfully' }),
        'success'
      );
    },
    onError: (error) => {
      showToast(
        error.message ||
          t('ai.overview.keyRotateFailed', {
            defaultValue: 'Failed to rotate OpenRouter API key',
          }),
        'error'
      );
    },
  });
}
