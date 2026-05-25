import { useMutation } from '@tanstack/react-query';
import { recordService } from '#features/database/services/record.service.js';
import { DEFAULT_DATABASE_SCHEMA } from '#features/database/helpers';

interface UseCSVExportOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function useCSVExport(
  tableName: string,
  schemaName: string = DEFAULT_DATABASE_SCHEMA,
  options?: UseCSVExportOptions
) {
  const mutation = useMutation({
    mutationFn: () => recordService.exportTableAsCSV(tableName, schemaName),
    onSuccess: () => {
      options?.onSuccess?.();
    },
    onError: (error) => {
      options?.onError?.(error);
    },
  });

  return {
    mutate: mutation.mutate,
    reset: mutation.reset,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
