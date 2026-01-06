import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  secretService,
} from '@/features/functions/services/secret.service';
import type { Secret, CreateSecretRequest } from '@insforge/shared-schemas';
import { useToast } from '@/lib/hooks/useToast';
import { useConfirm } from '@/lib/hooks/useConfirm';

export function useSecrets() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { confirm, confirmDialogProps } = useConfirm();
  const [searchQuery, setSearchQuery] = useState('');

  // Query to fetch all secrets
  const {
    data: allSecrets = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['secrets'],
    queryFn: () => secretService.listSecrets(),
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
  });

  // Filter out inactive secrets
  const secrets = allSecrets.filter((secret: Secret) => secret.isActive);

  // Create secret mutation
  const createSecretMutation = useMutation({
    mutationFn: (input: CreateSecretRequest) => secretService.createSecret(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['secrets'] });
      showToast('Secret created successfully', 'success');
    },
    onError: (error: Error) => {
      console.error('Failed to create secret:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create secret';
      showToast(errorMessage, 'error');
    },
  });

  // Delete secret mutation
  const deleteSecretMutation = useMutation({
    mutationFn: (key: string) => secretService.deleteSecret(key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['secrets'] });
      showToast('Secret deleted successfully', 'success');
    },
    onError: (error: Error) => {
      console.error('Failed to delete secret:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete secret';
      showToast(errorMessage, 'error');
    },
  });

  // Create secret with validation
  const createSecret = useCallback(
    async (key: string, value: string) => {
      if (!key.trim() || !value.trim()) {
        showToast('Please fill in both key and value', 'error');
        return false;
      }

      try {
        await createSecretMutation.mutateAsync({
          key: key.trim(),
          value: value.trim(),
        });
        return true;
      } catch {
        return false;
      }
    },
    [createSecretMutation, showToast]
  );

  // Delete secret with confirmation
  const deleteSecret = useCallback(
    async (secret: Secret) => {
      if (secret.isReserved) {
        showToast('Cannot delete reserved secrets', 'error');
        return false;
      }

      const shouldDelete = await confirm({
        title: 'Delete Secret',
        description: `You sure to delete "${secret.key}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      });

      if (shouldDelete) {
        try {
          await deleteSecretMutation.mutateAsync(secret.key);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    },
    [confirm, deleteSecretMutation, showToast]
  );

  // Filter secrets based on search query
  const filteredSecrets = secrets.filter((secret: Secret) =>
    secret.key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return {
    // Data
    secrets,
    filteredSecrets,
    secretsCount: secrets.length,
    searchQuery,

    // Loading states
    isLoading,
    isCreating: createSecretMutation.isPending,
    isDeleting: deleteSecretMutation.isPending,

    // Error
    error,

    // Actions
    createSecret,
    deleteSecret,
    setSearchQuery,
    refetch,

    // Confirm dialog props
    confirmDialogProps,
  };
}
