import { useState, useRef } from 'react';
import { Upload, X, Download, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/radix/Dialog.js';
import { Button } from '@/components/radix/Button.js';
import { useCSVImport } from '@/features/database/hooks/useCSVImport.js';
import { recordService, CSVImportResponse } from '@/features/database/services/record.service.js';
import { useToast } from '@/lib/hooks/useToast.js';
import { CSVErrorDialog } from './CSVErrorDialog.js';

interface CSVImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableName: string;
  onSuccess?: () => void;
}

export function CSVImportDialog({
  open,
  onOpenChange,
  tableName,
  onSuccess,
}: CSVImportDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isDownloadingCsv, setIsDownloadingCsv] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [errorData, setErrorData] = useState<CSVImportResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  const { mutate: importCSV, isPending, reset } = useCSVImport(tableName);

  const handleFileSelect = (file: File) => {
    const validation = recordService.validateCSVFile(file);

    if (!validation.valid) {
      showToast(validation.error || 'Invalid file', 'error');
      return;
    }

    setSelectedFile(file);
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFileSelect(files[0]);
    }
  };

  const handleImport = () => {
    if (!selectedFile) {
      showToast('Please select a file', 'error');
      return;
    }

    importCSV(selectedFile, {
      onSuccess: (data: CSVImportResponse) => {
        const successCount = data.csvImport?.successCount || 0;

        showToast(
          `Successfully imported ${successCount} record${successCount !== 1 ? 's' : ''} into ${tableName}`,
          'success'
        );

        handleClose();

        if (onSuccess) {
          onSuccess();
        }
      },
      onError: (error: unknown) => {
        // Check if error is a CSV validation response object
        if (error && typeof error === 'object' && 'success' in error && 'rowErrors' in error) {
          const errorResponse = error as CSVImportResponse;

          // Close import dialog
          onOpenChange(false);

          // Show error dialog with validation details
          setErrorData(errorResponse);
          setShowErrorDialog(true);
          return;
        }

        // Handle other errors (network, server errors, etc.)
        let errorMessage = 'Failed to import CSV. Please try again.';

        if (error instanceof Error) {
          errorMessage = error.message;
        } else if (error && typeof error === 'object' && 'message' in error) {
          errorMessage = String((error as { message: unknown }).message);
        }

        showToast(errorMessage, 'error');
      },
    });
  };

  const handleDownloadSample = async () => {
    setIsDownloadingCsv(true);
    try {
      await recordService.downloadSampleCSV(tableName);
      showToast(`Sample CSV for ${tableName} downloaded successfully`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to download sample CSV', 'error');
    } finally {
      setIsDownloadingCsv(false);
    }
  };

  const handleDownloadSampleClick = () => {
    handleDownloadSample().catch((error) => {
      console.error('Error downloading sample CSV:', error);
    });
  };

  const handleFileUploadAreaClick = () => {
    if (!isPending) {
      fileInputRef.current?.click();
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    reset();
    onOpenChange(false);
  };

  const handleErrorDialogClose = () => {
    setShowErrorDialog(false);
    setErrorData(null);
    setSelectedFile(null);
    reset();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-white">Import CSV Data</DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-gray-400">
              Upload a CSV file to populate the <strong>{tableName}</strong> table with data.{' '}
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 inline text-blue-600 dark:text-blue-400 underline hover:text-blue-700 dark:hover:text-blue-300"
                onClick={handleDownloadSampleClick}
                disabled={isDownloadingCsv}
              >
                <Download className="w-3 h-3 mr-1 inline" />
                Download sample CSV
              </Button>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* File Upload Area */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={handleFileUploadAreaClick}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                dragActive
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-500'
                  : 'border-gray-300 dark:border-neutral-700 hover:border-blue-400 dark:hover:border-blue-700 hover:bg-gray-50 dark:hover:bg-neutral-800/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                className="hidden"
                disabled={isPending}
              />

              {selectedFile ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {selectedFile.name}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                      }}
                      className="text-gray-500 hover:text-gray-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                      disabled={isPending}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-neutral-400">
                    {(selectedFile.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              ) : (
                <>
                  <Upload className="w-10 h-10 text-blue-400 dark:text-blue-500 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    Drag and drop your CSV file here
                  </p>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 mt-1">
                    or click to browse (max 50MB)
                  </p>
                </>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 justify-end pt-4">
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={isPending}
                className="border-gray-300 dark:border-neutral-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-neutral-800"
              >
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={!selectedFile || isPending}
                className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white"
              >
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isPending ? 'Importing...' : 'Import CSV'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Error Dialog */}
      {errorData && (
        <CSVErrorDialog
          open={showErrorDialog}
          onOpenChange={(open) => {
            if (!open) {
              handleErrorDialogClose();
            }
          }}
          tableName={tableName}
          errorData={errorData}
        />
      )}
    </>
  );
}
