import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { deploymentsService } from '#features/deployments/services/deployments.service';
import { useToast } from '@insforge/ui';
import { isInsForgeCloudProject } from '#lib/utils/utils';

const QUERY_KEY = ['deployments', 'custom-domains'];

/**
 * Hook for managing user-owned custom domains on a deployment.
 * Provides methods to list, add, verify DNS, and remove custom domains,
 * each backed by React Query mutations with toast feedback.
 */
export function useCustomDomains() {
  const { t } = useTranslation('chrome');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const isCloudProject = isInsForgeCloudProject();

  const {
    data: domains = [],
    isLoading,
    isError,
    error,
    refetch: refetchDomains,
  } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => deploymentsService.listCustomDomains(),
    enabled: isCloudProject,
    retry: false,
  });

  const addMutation = useMutation({
    mutationFn: (domain: string) => deploymentsService.addCustomDomain(domain),
    onSuccess: (domain) => {
      showToast(
        t('deployments.domainAdded', {
          defaultValue: 'Domain {{domain}} added. Add the required DNS records to activate it.',
          domain: domain.domain,
        }),
        'success'
      );
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => {
      showToast(
        error.message || t('deployments.addDomainFailed', { defaultValue: 'Failed to add domain' }),
        'error'
      );
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (domain: string) => deploymentsService.verifyCustomDomain(domain),
    onSuccess: (result) => {
      if (result.verified && !result.misconfigured) {
        showToast(
          t('deployments.domainVerified', { defaultValue: 'Domain verified successfully!' }),
          'success'
        );
      } else if (result.misconfigured) {
        showToast(
          t('deployments.domainDnsNotPointing', {
            defaultValue: 'Domain ownership is verified, but DNS is not pointing to Vercel yet.',
          }),
          'error'
        );
      } else {
        showToast(
          t('deployments.verificationPending', {
            defaultValue:
              'Verification is still pending. Check the required DNS records and try again.',
          }),
          'error'
        );
      }
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => {
      showToast(
        error.message ||
          t('deployments.verifyDomainFailed', { defaultValue: 'Failed to verify domain' }),
        'error'
      );
    },
  });

  const removeMutation = useMutation({
    mutationFn: (domain: string) => deploymentsService.removeCustomDomain(domain),
    onSuccess: (_data, domain) => {
      showToast(
        t('deployments.domainRemoved', {
          defaultValue: 'Domain {{domain}} removed',
          domain,
        }),
        'success'
      );
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => {
      showToast(
        error.message ||
          t('deployments.removeDomainFailed', { defaultValue: 'Failed to remove domain' }),
        'error'
      );
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
