import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '@insforge/ui';
import type { ModelGatewayConfig, UpdateModelGatewayConfig } from '@insforge/shared-schemas';
import { aiService } from '#features/ai/services/ai.service';
import { AI_OVERVIEW_QUERY_KEY } from '#features/ai/hooks/useAIOverview';
import { OPENROUTER_KEY_QUERY_KEY } from '#features/ai/hooks/useOpenRouterKey';

export const MODEL_GATEWAY_CONFIG_QUERY_KEY = ['model-gateway-config'] as const;

export function useModelGatewayConfig(enabled = true) {
  return useQuery<ModelGatewayConfig>({
    queryKey: MODEL_GATEWAY_CONFIG_QUERY_KEY,
    queryFn: () => aiService.getConfig(),
    enabled,
    staleTime: 60 * 1000,
    retry: false,
  });
}

export function useUpdateModelGatewayConfig() {
  const { t } = useTranslation('chrome');
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  return useMutation<ModelGatewayConfig, Error, UpdateModelGatewayConfig>({
    mutationFn: (input) => aiService.updateConfig(input),
    onSuccess: (config) => {
      queryClient.setQueryData(MODEL_GATEWAY_CONFIG_QUERY_KEY, config);
      showToast(
        t('ai.settings.saved', { defaultValue: 'Model Gateway settings saved' }),
        'success'
      );
    },
    onError: (error) => {
      showToast(
        error.message ||
          t('ai.settings.saveFailed', { defaultValue: 'Failed to save Model Gateway settings' }),
        'error'
      );
    },
    onSettled: () => {
      // A multi-key save may partially succeed because the two credentials are independent.
      // Reconcile all credential-dependent views even when one write fails.
      void queryClient.invalidateQueries({ queryKey: MODEL_GATEWAY_CONFIG_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: OPENROUTER_KEY_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: AI_OVERVIEW_QUERY_KEY });
    },
  });
}
