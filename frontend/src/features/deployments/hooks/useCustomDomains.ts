import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deploymentsService } from '../services/deployments.service';
import { useToast } from '@/lib/hooks/useToast';

const QUERY_KEY = ['deployments', 'custom-domains'];

/**
 * Hook for managing user-owned custom domains on a deployment.
 * Provides methods to list, add, verify DNS, and remove custom domains,
 * each backed by React Query mutations with toast feedback.
 */
export function useCustomDomains() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: domains = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => deploymentsService.listCustomDomains(),
  });

  const addMutation = useMutation({
    mutationFn: (domain: string) => deploymentsService.addCustomDomain(domain),
    onSuccess: (domain) => {
      showToast(`Domain ${domain.domain} added. Configure your DNS records to verify it.`, 'success');
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to add domain', 'error');
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (domain: string) => deploymentsService.verifyCustomDomain(domain),
    onSuccess: (result) => {
      if (result.verified) {
        showToast('Domain verified successfully!', 'success');
      } else {
        showToast('DNS not propagated yet. Please check your DNS settings and try again.', 'error');
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
