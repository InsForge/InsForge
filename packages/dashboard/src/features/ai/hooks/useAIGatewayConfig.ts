import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aiService } from '#features/ai/services/ai.service';
import type { GatewayConfigResponse } from '@insforge/shared-schemas';

const GATEWAY_CONFIG_QUERY_KEY = ['ai-gateway-config'];

export function useAIGatewayConfig() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<GatewayConfigResponse>({
    queryKey: GATEWAY_CONFIG_QUERY_KEY,
    queryFn: () => aiService.getGatewayConfig(),
    staleTime: 30 * 1000,
  });

  const setBYOKKey = useMutation({
    mutationFn: (apiKey: string) => aiService.setGatewayBYOKKey(apiKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: GATEWAY_CONFIG_QUERY_KEY });
      // Invalidate credits since the key source changed
      void queryClient.invalidateQueries({ queryKey: ['ai-remaining-credits'] });
    },
  });

  const removeBYOKKey = useMutation({
    mutationFn: () => aiService.removeGatewayBYOKKey(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: GATEWAY_CONFIG_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['ai-remaining-credits'] });
    },
  });

  return {
    gatewayConfig: data,
    isLoadingGatewayConfig: isLoading,
    gatewayConfigError: error,
    setBYOKKey,
    removeBYOKKey,
  };
}
