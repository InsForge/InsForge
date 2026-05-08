import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deploymentsService } from '#features/deployments/services/deployments.service';
import type { DeploymentEnvVar, UpsertEnvVarRequest } from '@insforge/shared-schemas';
import { useToast } from '#lib/hooks/useToast';
import { useConfirm } from '#lib/hooks/useConfirm';

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
    mutationFn: async (inputs: UpsertEnvVarRequest[]) => {
      const result = await deploymentsService.upsertEnvVars({ envVars: inputs });
      return result.count;
    },
    onSuccess: (count) => {
      void queryClient.invalidateQueries({ queryKey: ['deployment-env-vars'] });
      showToast(
        count === 1
          ? 'Environment variable saved successfully'
          : `${count} environment variables saved successfully`,
        'success'
      );
    },
    onError: (error: Error) => {
      void queryClient.invalidateQueries({ queryKey: ['deployment-env-vars'] });
      console.error('Failed to save environment variable:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to save environment variables';
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
  const upsertEnvVars = useCallback(
    async (inputs: UpsertEnvVarRequest[]) => {
      const normalizedInputs = inputs
        .map((input) => ({
          key: input.key.trim(),
          value: input.value,
        }))
        .filter((input) => input.key || input.value);

      if (normalizedInputs.length === 0) {
        showToast('Add at least one environment variable', 'error');
        return false;
      }

      const incompleteInput = normalizedInputs.find((input) => !input.key);
      if (incompleteInput) {
        showToast('One or more rows are missing a key', 'error');
        return false;
      }

      const seenKeys = new Set<string>();
      const duplicateKeys = normalizedInputs
        .map((input) => input.key)
        .filter((key) => {
          if (seenKeys.has(key)) {
            return true;
          }

          seenKeys.add(key);
          return false;
        });

      if (duplicateKeys.length > 0) {
        showToast(
          `Duplicate keys found: ${Array.from(new Set(duplicateKeys)).join(', ')}`,
          'error'
        );
        return false;
      }

      try {
        await upsertEnvVarMutation.mutateAsync(normalizedInputs);
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
    upsertEnvVars,
    deleteEnvVar,
    refetch,

    // Confirm dialog props
    confirmDialogProps,
  };
}
