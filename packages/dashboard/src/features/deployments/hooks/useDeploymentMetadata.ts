import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deploymentsService } from '../services/deployments.service';

export function useDeploymentMetadata() {
  const queryClient = useQueryClient();

  const {
    data: metadata,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['deployment-metadata'],
    queryFn: () => deploymentsService.getMetadata(),
    staleTime: 30 * 1000, // Cache for 30 seconds
    retry: false,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['deployment-metadata'] });
  };

  return {
    currentDeploymentId: metadata?.currentDeploymentId ?? null,
    defaultDomainUrl: metadata?.defaultDomainUrl ?? null,
    customDomainUrl: metadata?.customDomainUrl ?? null,
    isLoading,
    error,
    refetch,
    invalidate,
  };
}
