import { useMutation } from '@tanstack/react-query';
import { advanceService } from '#features/database/services/advance.service';
import { ExplainSQLResponse } from '@insforge/shared-schemas';
import { useToast } from '#lib/hooks/useToast';

interface UseExplainSQLOptions {
  onSuccess?: (data: ExplainSQLResponse) => void;
  onError?: (error: Error) => void;
  showErrorToast?: boolean;
}

interface ExplainSQLParams {
  query: string;
  params?: unknown[];
}

export function useExplainSQL(options?: UseExplainSQLOptions) {
  const { showToast } = useToast();

  const mutation = useMutation({
    mutationFn: async ({ query, params = [] }: ExplainSQLParams) => {
      return advanceService.explainRawSQL(query, params);
    },
    onSuccess: (data) => {
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      if (options?.showErrorToast !== false) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to explain SQL query';
        showToast(errorMessage, 'error');
      }
      options?.onError?.(error);
    },
  });

  return {
    explainSQL: mutation.mutate,
    explainSQLAsync: mutation.mutateAsync,
    reset: mutation.reset,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    data: mutation.data,
  };
}
