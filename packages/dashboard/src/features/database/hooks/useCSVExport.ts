import { useMutation } from '@tanstack/react-query';
import { recordService } from '#features/database/services/record.service.js';
import { DEFAULT_DATABASE_SCHEMA } from '#features/database/helpers';

/**
 * Options for configuring CSV export behavior and callbacks
 * @property {() => void} [onSuccess] - Callback invoked after successful export
 * @property {(error: Error) => void} [onError] - Callback invoked if export fails
 * @property {(message: string) => void} [onWarning] - Callback invoked if export is limited to 10k rows
 */
interface UseCSVExportOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  onWarning?: (message: string) => void;
}

/**
 * React hook for exporting table records as CSV
 * Exports up to 10,000 rows to prevent browser memory issues
 * @param {string} tableName - Name of the table to export
 * @param {string} [schemaName=DEFAULT_DATABASE_SCHEMA] - Database schema name
 * @param {UseCSVExportOptions} [options] - Configuration options and callbacks
 * @returns {Object} Mutation control object
 * @returns {Function} returns.mutate - Triggers the export operation
 * @returns {Function} returns.reset - Resets mutation state
 * @returns {boolean} returns.isPending - Loading state during export
 * @returns {Error | null} returns.error - Export error if any
 */
export function useCSVExport(
  tableName: string,
  schemaName: string = DEFAULT_DATABASE_SCHEMA,
  options?: UseCSVExportOptions
) {
  const mutation = useMutation({
    mutationFn: () => recordService.exportTableAsCSV(tableName, schemaName),
    onSuccess: (data) => {
      if (data.limited) {
        options?.onWarning?.('Export limited to 10,000 rows. Your table contains more data.');
      }
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
