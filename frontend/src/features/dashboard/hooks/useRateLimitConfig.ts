import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GetRateLimitConfigResponse, UpdateRateLimitConfigRequest } from '@insforge/shared-schemas';
import { useToast } from '@/lib/hooks/useToast';
import { rateLimitConfigService } from '@/features/dashboard/services/rate-limit-config.service';

export const RATE_LIMIT_CONFIG_QUERY_KEY = ['auth-rate-limit-config'];

export function useRateLimitConfig() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: config,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<GetRateLimitConfigResponse>({
    queryKey: RATE_LIMIT_CONFIG_QUERY_KEY,
    queryFn: () => rateLimitConfigService.getConfig(),
  });

  const updateConfigMutation = useMutation({
    mutationFn: (payload: UpdateRateLimitConfigRequest) =>
      rateLimitConfigService.updateConfig(payload),
    onSuccess: (updatedConfig) => {
      queryClient.setQueryData<GetRateLimitConfigResponse>(
        RATE_LIMIT_CONFIG_QUERY_KEY,
        updatedConfig
      );
      showToast('Rate-limit configuration updated successfully', 'success');
    },
    onError: (mutationError: Error) => {
      showToast(mutationError.message || 'Failed to update rate-limit configuration', 'error');
    },
  });

  return {
    config,
    isLoading,
    isError,
    error,
    isUpdating: updateConfigMutation.isPending,
    updateConfig: updateConfigMutation.mutateAsync,
    refetch,
  };
}

