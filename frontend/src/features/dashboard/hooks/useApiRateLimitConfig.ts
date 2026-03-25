import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ApiRateLimitConfigSchema,
  type UpdateApiRateLimitConfigRequest,
} from '@insforge/shared-schemas';
import { metadataService } from '@/lib/services/metadata.service';
import { useToast } from '@/lib/hooks/useToast';

const API_RATE_LIMIT_CONFIG_QUERY_KEY = ['api-rate-limit-config'];

export function useApiRateLimitConfig() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery<ApiRateLimitConfigSchema>({
    queryKey: API_RATE_LIMIT_CONFIG_QUERY_KEY,
    queryFn: () => metadataService.getApiRateLimitConfig(),
  });

  const updateConfigMutation = useMutation({
    mutationFn: (input: UpdateApiRateLimitConfigRequest) =>
      metadataService.updateApiRateLimitConfig(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: API_RATE_LIMIT_CONFIG_QUERY_KEY });
      showToast('API rate-limit configuration updated successfully', 'success');
    },
    onError: (mutationError: Error) => {
      showToast(mutationError.message || 'Failed to update API rate-limit configuration', 'error');
    },
  });

  return {
    config,
    isLoading,
    isUpdating: updateConfigMutation.isPending,
    error,
    updateConfig: updateConfigMutation.mutate,
    refetch,
  };
}
