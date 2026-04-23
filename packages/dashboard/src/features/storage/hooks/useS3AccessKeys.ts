import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  S3AccessKeySchema,
  S3AccessKeyWithSecretSchema,
  CreateS3AccessKeyRequest,
} from '@insforge/shared-schemas';
import { s3AccessKeyService } from '../services/s3-access-key.service';
import { useToast } from '../../../lib/hooks/useToast';

/**
 * React Query hook for managing S3 access keys. Returns the list query plus
 * create/delete mutations. The create mutation's `onSuccess` callback
 * receives the `S3AccessKeyWithSecretSchema` response — callers MUST capture
 * `secretAccessKey` there because subsequent list responses don't include it.
 */
export function useS3AccessKeys() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const listQuery = useQuery<S3AccessKeySchema[]>({
    queryKey: ['storage', 's3-access-keys'],
    queryFn: () => s3AccessKeyService.list(),
  });

  const createMutation = useMutation<S3AccessKeyWithSecretSchema, Error, CreateS3AccessKeyRequest>({
    mutationFn: (input) => s3AccessKeyService.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage', 's3-access-keys'] });
    },
    onError: (error) => {
      showToast(error.message || 'Failed to create access key', 'error');
    },
  });

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: (id) => s3AccessKeyService.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage', 's3-access-keys'] });
      showToast('Access key revoked', 'success');
    },
    onError: (error) => {
      showToast(error.message || 'Failed to revoke access key', 'error');
    },
  });

  return {
    keys: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error,
    refetch: listQuery.refetch,
    createAccessKey: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    deleteAccessKey: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
  };
}
