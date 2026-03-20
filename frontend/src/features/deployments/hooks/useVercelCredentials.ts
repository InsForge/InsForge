import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deploymentsService } from '../services/deployments.service';
import { useToast } from '@/lib/hooks/useToast';

export function useVercelCredentials() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['vercel-credentials'],
    queryFn: () => deploymentsService.getVercelCredentials(),
  });

  const setCredentialsMutation = useMutation({
    mutationFn: (credentials: { token: string; teamId: string; projectId: string }) =>
      deploymentsService.setVercelCredentials(credentials),
    onSuccess: (response) => {
      showToast(response.message || 'Credentials saved successfully', 'success');
      void queryClient.invalidateQueries({ queryKey: ['vercel-credentials'] });
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to save credentials', 'error');
    },
  });

  const clearCredentialsMutation = useMutation({
    mutationFn: () => deploymentsService.clearVercelCredentials(),
    onSuccess: (response) => {
      showToast(response.message || 'Credentials cleared', 'success');
      void queryClient.invalidateQueries({ queryKey: ['vercel-credentials'] });
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to clear credentials', 'error');
    },
  });

  return {
    credentials: data,
    isLoading,
    error,
    setCredentials: setCredentialsMutation.mutateAsync,
    clearCredentials: clearCredentialsMutation.mutateAsync,
    isSaving: setCredentialsMutation.isPending,
    isClearing: clearCredentialsMutation.isPending,
    refetch,
  };
}
