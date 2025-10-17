import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/radix/Dialog.js';
import { Button } from '@/components/radix/Button.js';
import { Alert, AlertDescription } from '@/components/radix/Alert.js';
import { CSVImportResponse } from '@/features/database/services/record.service.js';

interface CSVErrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableName: string;
  errorData: CSVImportResponse;
}

export function CSVErrorDialog({ open, onOpenChange, errorData }: CSVErrorDialogProps) {
  const totalErrors = errorData.totalRowErrors || 0;
  const validRows = errorData.validRowCount || 0;
  const rowErrors = errorData.rowErrors || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-1 flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-500" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-gray-900 dark:text-white">CSV Import Failed</DialogTitle>
              <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                {errorData.message}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 px-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-4 border border-red-200 dark:border-red-900/50">
              <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">
                Rows with Errors
              </p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{totalErrors}</p>
            </div>
            <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-4 border border-green-200 dark:border-green-900/50">
              <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">
                Valid Rows
              </p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{validRows}</p>
            </div>
          </div>

          {/* Error Table */}
          {rowErrors.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-gray-900 dark:text-white">
                Error Details ({rowErrors.length}{' '}
                {rowErrors.length !== totalErrors ? `of ${totalErrors}` : ''} rows)
              </h3>
              <div className="border border-gray-200 dark:border-neutral-700 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50 dark:bg-neutral-800 border-b border-gray-200 dark:border-neutral-700">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-900 dark:text-white w-20">
                          Row #
                        </th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-900 dark:text-white">
                          Error Details
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rowErrors.map((error, idx) => (
                        <tr
                          key={idx}
                          className="border-b border-gray-200 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-800/50 transition"
                        >
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 font-semibold text-xs">
                              {error.rowNumber}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              {error.errors.map((err, errIdx) => (
                                <div
                                  key={errIdx}
                                  className="flex items-start gap-2 text-gray-700 dark:text-gray-300"
                                >
                                  <span className="text-red-500 dark:text-red-400 mt-0.5 flex-shrink-0">
                                    •
                                  </span>
                                  <span className="break-words text-sm">{err}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {totalErrors > rowErrors.length && (
                <p className="text-xs text-gray-500 dark:text-neutral-400 text-center py-2">
                  Showing first {rowErrors.length} of {totalErrors} errors
                </p>
              )}
            </div>
          )}

          {/* Instructions */}
          <Alert className="border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/30">
            <AlertDescription className="text-blue-900 dark:text-blue-300">
              <p className="font-semibold mb-2">How to fix:</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>Review each error in the table above</li>
                <li>Correct the data in your CSV file</li>
                <li>
                  Common issues: duplicate values in unique columns, missing required fields,
                  invalid foreign key references
                </li>
                <li>Re-upload the corrected CSV file</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>

        {/* Footer Actions */}
        <div className="flex gap-2 justify-end pt-4 px-6 border-t border-gray-200 dark:border-neutral-700">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-gray-300 dark:border-neutral-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-neutral-800"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
