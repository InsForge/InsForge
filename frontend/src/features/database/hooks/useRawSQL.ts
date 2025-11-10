import { useMutation, useQueryClient } from '@tanstack/react-query';
import { advanceService, RawSQLResponse } from '../services/advance.service';
import { useToast } from '@/lib/hooks/useToast';

interface UseRawSQLOptions {
  onSuccess?: (data: RawSQLResponse) => void;
  onError?: (error: Error) => void;
  showSuccessToast?: boolean;
  showErrorToast?: boolean;
}

interface RawSQLParams {
  query: string;
  params?: unknown[];
}

export function useRawSQL(options?: UseRawSQLOptions) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ query, params = [] }: RawSQLParams) => {
      return advanceService.runRawSQL(query, params);
    },
    onSuccess: (data) => {
      // Invalidate database schema queries to ensure UI reflects any schema changes
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      void queryClient.invalidateQueries({ queryKey: ['tables', 'schemas'] });

      if (options?.showSuccessToast !== false) {
        const message = data.message || 'SQL query executed successfully';
        showToast(message, 'success');
      }
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      if (options?.showErrorToast !== false) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to execute SQL query';
        showToast(errorMessage, 'error');
      }
      options?.onError?.(error);
    },
  });

  return {
    executeSQL: mutation.mutate,
    executeSQLAsync: mutation.mutateAsync,
    reset: mutation.reset,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    data: mutation.data,
  };
}
