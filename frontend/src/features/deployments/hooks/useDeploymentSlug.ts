import { useMutation } from '@tanstack/react-query';
import { deploymentsService } from '../services/deployments.service';
import { useToast } from '@/lib/hooks/useToast';

export function useDeploymentSlug() {
  const { showToast } = useToast();

  const updateSlugMutation = useMutation({
    mutationFn: (slug: string | null) => deploymentsService.updateSlug(slug),
    onSuccess: (data) => {
      showToast(
        data.slug ? 'Custom domain saved successfully' : 'Custom domain removed successfully',
        'success'
      );
    },
    onError: (error: Error) => {
      console.error('Failed to update custom domain:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to update custom domain';
      showToast(errorMessage, 'error');
    },
  });

  return {
    updateSlug: updateSlugMutation.mutateAsync,
    isUpdating: updateSlugMutation.isPending,
    error: updateSlugMutation.error,
  };
}
