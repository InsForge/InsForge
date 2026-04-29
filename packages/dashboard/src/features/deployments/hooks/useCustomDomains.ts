import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deploymentsService } from '../services/deployments.service';
import { useToast } from '../../../lib/hooks/useToast';
import { isInsForgeCloudProject, isMockCloudMode } from '../../../lib/utils/utils';

const QUERY_KEY = ['deployments', 'custom-domains'];

/**
 * Hook for managing user-owned custom domains on a deployment.
 * Provides methods to list, add, verify DNS, and remove custom domains,
 * each backed by React Query mutations with toast feedback.
 */
export function useCustomDomains() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const isCloudProject = isInsForgeCloudProject();
  const isMock = isMockCloudMode();

  const {
    data: domains = [],
    isLoading,
    isError,
    error,
    refetch: refetchDomains,
  } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => deploymentsService.listCustomDomains(),
    enabled: isCloudProject && !isMock,
    retry: false,
  });

  const addMutation = useMutation({
    mutationFn: (domain: string) => deploymentsService.addCustomDomain(domain),
    onSuccess: (domain) => {
      showToast(
        `Domain ${domain.domain} added. Add the required DNS records to activate it.`,
        'success'
      );
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to add domain', 'error');
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (domain: string) => deploymentsService.verifyCustomDomain(domain),
    onSuccess: (result) => {
      if (result.verified && !result.misconfigured) {
        showToast('Domain verified successfully!', 'success');
      } else if (result.misconfigured) {
        showToast('Domain ownership is verified, but DNS is not pointing to Vercel yet.', 'error');
      } else {
        showToast(
          'Verification is still pending. Check the required DNS records and try again.',
          'error'
        );
      }
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to verify domain', 'error');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (domain: string) => deploymentsService.removeCustomDomain(domain),
    onSuccess: (_data, domain) => {
      showToast(`Domain ${domain} removed`, 'success');
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to remove domain', 'error');
    },
  });

  return {
    domains,
    isLoading,
    isError,
    error,
    refetchDomains,
    addDomain: addMutation.mutateAsync,
    isAdding: addMutation.isPending,
    verifyDomain: verifyMutation.mutateAsync,
    isVerifying: verifyMutation.isPending,
    removeDomain: removeMutation.mutateAsync,
    isRemoving: removeMutation.isPending,
    verifyingDomain: verifyMutation.variables,
    removingDomain: removeMutation.variables,
  };
}
