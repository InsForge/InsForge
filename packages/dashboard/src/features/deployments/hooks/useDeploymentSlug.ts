import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { deploymentsService } from '#features/deployments/services/deployments.service';
import { useToast } from '@insforge/ui';

export function useDeploymentSlug() {
  const { t } = useTranslation('chrome');
  const { showToast } = useToast();

  const updateSlugMutation = useMutation({
    mutationFn: (slug: string | null) => deploymentsService.updateSlug(slug),
    onSuccess: (data) => {
      showToast(
        data.slug
          ? t('deployments.customDomainSaved', {
              defaultValue: 'Custom domain saved successfully',
            })
          : t('deployments.customDomainRemoved', {
              defaultValue: 'Custom domain removed successfully',
            }),
        'success'
      );
    },
    onError: (error: Error) => {
      console.error('Failed to update custom domain:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : t('deployments.updateCustomDomainFailed', {
              defaultValue: 'Failed to update custom domain',
            });
      showToast(errorMessage, 'error');
    },
  });

  return {
    updateSlug: updateSlugMutation.mutateAsync,
    isUpdating: updateSlugMutation.isPending,
    error: updateSlugMutation.error,
  };
}
