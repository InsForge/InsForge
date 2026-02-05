import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deploymentsService } from '../services/deployments.service';
import type { DeploymentEnvVar, UpsertEnvVarRequest } from '@insforge/shared-schemas';
import { useToast } from '@/lib/hooks/useToast';
import { useConfirm } from '@/lib/hooks/useConfirm';

export function useDeploymentEnvVars() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { confirm, confirmDialogProps } = useConfirm();

  // Query to fetch all env vars
  const {
    data: envVars = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['deployment-env-vars'],
    queryFn: () => deploymentsService.listEnvVars(),
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
    retry: false,
  });

  // Upsert env var mutation
  const upsertEnvVarMutation = useMutation({
    mutationFn: (input: UpsertEnvVarRequest) => deploymentsService.upsertEnvVar(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deployment-env-vars'] });
      showToast('Environment variable saved successfully', 'success');
    },
    onError: (error: Error) => {
      console.error('Failed to save environment variable:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to save environment variable';
      showToast(errorMessage, 'error');
    },
  });

  // Delete env var mutation
  const deleteEnvVarMutation = useMutation({
    mutationFn: (id: string) => deploymentsService.deleteEnvVar(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deployment-env-vars'] });
      showToast('Environment variable deleted successfully', 'success');
    },
    onError: (error: Error) => {
      console.error('Failed to delete environment variable:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to delete environment variable';
      showToast(errorMessage, 'error');
    },
  });

  // Create/Update env var with validation
  const upsertEnvVar = useCallback(
    async (key: string, value: string) => {
      if (!key.trim() || !value.trim()) {
        showToast('Please fill in both key and value', 'error');
        return false;
      }

      try {
        await upsertEnvVarMutation.mutateAsync({
          key: key.trim(),
          value: value.trim(),
        });
        return true;
      } catch {
        return false;
      }
    },
    [upsertEnvVarMutation, showToast]
  );

  // Delete env var with confirmation
  const deleteEnvVar = useCallback(
    async (envVar: DeploymentEnvVar) => {
      const shouldDelete = await confirm({
        title: 'Delete Environment Variable',
        description: `Are you sure you want to delete "${envVar.key}"? This will affect your deployed application.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      });

      if (shouldDelete) {
        try {
          await deleteEnvVarMutation.mutateAsync(envVar.id);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    },
    [confirm, deleteEnvVarMutation]
  );

  return {
    // Data
    envVars,
    envVarsCount: envVars.length,

    // Loading states
    isLoading,
    isUpserting: upsertEnvVarMutation.isPending,
    isDeleting: deleteEnvVarMutation.isPending,

    // Error
    error,

    // Actions
    upsertEnvVar,
    deleteEnvVar,
    refetch,

    // Confirm dialog props
    confirmDialogProps,
  };
}
