import { useMutation, useQueryClient } from '@tanstack/react-query';
import { advanceService } from '#features/database/services/advance.service';
import { databaseTableQueryKeys } from '#features/database/queryKeys';
import { RawSQLResponse } from '@insforge/shared-schemas';
import { useToast } from '@insforge/ui';

interface UseRawSQLOptions {
  schemaName?: string;
  onSuccess?: (data: RawSQLResponse) => void;
  onError?: (error: Error) => void;
  showSuccessToast?: boolean;
  showErrorToast?: boolean;
}

interface RawSQLParams {
  query: string;
  params?: unknown[];
  explain?: boolean;
}

/**
 * React Query mutation hook for executing raw SQL queries in the database.
 * Upon successful execution, invalidates schema and RLS query caches to ensure
 * the dashboard reflects any structural or security changes.
 *
 * @param options - Execution callbacks and toast configuration
 * @returns React Query mutation object for running SQL queries
 */
export function useRawSQL(options?: UseRawSQLOptions) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ query, params = [], explain }: RawSQLParams) => {
      return advanceService.runRawSQL(query, params, explain);
    },
    onSuccess: (data) => {
      // Invalidate database schema and RLS queries to ensure UI reflects any schema/RLS changes
      if (options?.schemaName) {
        void queryClient.invalidateQueries({
          queryKey: databaseTableQueryKeys.tables(options.schemaName),
        });
        void queryClient.invalidateQueries({
          queryKey: ['database', 'table-schemas', options.schemaName],
        });
        void queryClient.invalidateQueries({
          queryKey: databaseTableQueryKeys.tableRlsStatuses(options.schemaName),
        });
        void queryClient.invalidateQueries({
          queryKey: ['database', 'policies', options.schemaName],
        });
      } else {
        // Safe broader invalidation strategy when schema cannot be determined or multi-schema SQL
        void queryClient.invalidateQueries({ queryKey: ['database', 'tables'] });
        void queryClient.invalidateQueries({ queryKey: ['database', 'table-schemas'] });
        void queryClient.invalidateQueries({ queryKey: ['database', 'tables-rls'] });
        void queryClient.invalidateQueries({ queryKey: ['database', 'policies'] });
      }

      if (options?.showSuccessToast !== false) {
        const message = 'SQL query executed successfully';
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
