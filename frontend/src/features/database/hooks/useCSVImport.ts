import { useMutation } from '@tanstack/react-query';
import { recordService } from '../services/record.service.js';
import { BulkUpsertResponse } from '@insforge/shared-schemas';

interface UseCSVImportOptions {
  onSuccess?: (data: BulkUpsertResponse) => void;
  onError?: (error: Error) => void;
}

export function useCSVImport(tableName: string, options?: UseCSVImportOptions) {
  const mutation = useMutation({
    mutationFn: async (file: File) => {
      return recordService.importCSV(tableName, file);
    },
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
