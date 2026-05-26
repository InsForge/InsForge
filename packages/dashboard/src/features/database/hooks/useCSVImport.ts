import { useMutation } from '@tanstack/react-query';
import { DEFAULT_DATABASE_SCHEMA } from '#features/database/helpers';
import { recordService } from '#features/database/services/record.service.js';
import { BulkUpsertResponse } from '@insforge/shared-schemas';

interface UseCSVImportOptions {
  onSuccess?: (data: BulkUpsertResponse) => void;
  onError?: (error: Error) => void;
}

export function useCSVImport(
  tableName: string,
  schemaName: string = DEFAULT_DATABASE_SCHEMA,
  options?: UseCSVImportOptions
) {
  const mutation = useMutation({
    mutationFn: (file: File) => recordService.importCSV(tableName, file, schemaName),
    onSuccess: (data) => {
      // Always call onSuccess, let the component decide what to do based on data.success
      options?.onSuccess?.(data);
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
