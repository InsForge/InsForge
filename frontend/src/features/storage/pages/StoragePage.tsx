import React, { useState, useEffect, useRef, useCallback, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import PencilIcon from '@/assets/icons/pencil.svg?react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import { useStorage } from '@/features/storage/hooks/useStorage';
import { StorageSidebar } from '@/features/storage/components/StorageSidebar';
import { StorageManager } from '@/features/storage/components/StorageManager';
import { BucketFormDialog } from '@/features/storage/components/BucketFormDialog';

import { useConfirm } from '@/lib/hooks/useConfirm';
import { useToast } from '@/lib/hooks/useToast';
import { useUploadToast } from '@/features/storage/components/UploadToast';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
import {
  SelectionClearButton,
  DeleteActionButton,
  Alert,
  AlertDescription,
  ConfirmDialog,
  EmptyState,
  TableHeader,
} from '@/components';

interface BucketFormState {
  mode: 'create' | 'edit';
  name: string | null;
  isPublic: boolean;
}

export default function StoragePage() {
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Bucket form state
  const [bucketFormOpen, setBucketFormOpen] = useState(false);
  const [bucketFormState, setBucketFormState] = useState<BucketFormState>({
    mode: 'create',
    name: null,
    isPublic: false,
  });
  const queryClient = useQueryClient();
  const { confirm, confirmDialogProps } = useConfirm();
  const { showToast } = useToast();
  const { showUploadToast, updateUploadProgress, cancelUpload } = useUploadToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);

  const {
    buckets,
    isLoadingBuckets: isLoading,
    bucketsError,
    refetchBuckets,
    useBucketStats,
    uploadObject,
    deleteObjects,
    deleteBucket,
  } = useStorage();

  const { data: bucketStats } = useBucketStats();

  // Build bucket info map
  const bucketInfo = React.useMemo(() => {
    return bucketStats || {};
  }, [bucketStats]);

  // Auto-select first bucket
  useEffect(() => {
    if (buckets.length && !selectedBucket) {
      setSelectedBucket(buckets[0].name);
    }
  }, [buckets, selectedBucket]);

  // Clear selected files when switching buckets
  useEffect(() => {
    setSelectedFiles(new Set());
  }, [selectedBucket]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextQuery = searchValue.trim();
      if (nextQuery !== searchQuery) {
        setSearchQuery(nextQuery);
      }
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchQuery, searchValue]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      setSelectedFiles(new Set());
      setSearchValue('');
      setSearchQuery('');
      await Promise.all([
        refetchBuckets(),
        queryClient.invalidateQueries({ queryKey: ['storage'] }),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Handle bulk delete files
  const handleBulkDeleteFiles = async (fileKeys: string[]) => {
    if (!selectedBucket || !fileKeys.length) {
      return;
    }

    const shouldDelete = await confirm({
      title: `Delete ${fileKeys.length} ${fileKeys.length === 1 ? 'file' : 'files'}`,
      description: `Are you sure you want to delete ${fileKeys.length} ${fileKeys.length === 1 ? 'file' : 'files'}? This action cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });

    if (shouldDelete) {
      deleteObjects({ bucket: selectedBucket, keys: fileKeys });
      setSelectedFiles(new Set());
    }
  };

  const uploadFiles = async (files: FileList | File[] | null) => {
    if (!files || !files.length || !selectedBucket) {
      return;
    }

    setIsUploading(true);

    // Create abort controller for cancellation
    uploadAbortControllerRef.current = new AbortController();

    // Show upload toast
    const toastId = showUploadToast(files.length, {
      onCancel: () => {
        uploadAbortControllerRef.current?.abort();
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      },
    });

    let successCount = 0;

    // Upload files sequentially with individual error handling
    for (let i = 0; i < files.length; i++) {
      if (uploadAbortControllerRef.current?.signal.aborted) {
        break;
      }

      // Update progress
      const progress = Math.round(((i + 1) / files.length) * 100);
      updateUploadProgress(toastId, progress);

      try {
        await uploadObject({
          bucket: selectedBucket,
          objectKey: files[i].name,
          file: files[i],
        });
        successCount++;
      } catch (error) {
        // Handle individual file upload error
        const fileName = files[i].name;

        // Show individual file error (but don't stop the overall process)
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        showToast(`Failed to upload "${fileName}": ${errorMessage}`, 'error');
      }
    }
    showToast(`${successCount} files uploaded successfully`, 'success');

    // Complete the upload toast
    cancelUpload(toastId);

    // Always reset uploading state
    setIsUploading(false);
    uploadAbortControllerRef.current = null;

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = useCallback(uploadFiles, [
    cancelUpload,
    selectedBucket,
    showToast,
    showUploadToast,
    updateUploadProgress,
    uploadObject,
  ]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await handleFileUpload(event.target.files);
  };

  const handleDeleteBucket = async (bucketName: string) => {
    const confirmOptions = {
      title: 'Delete Bucket',
      description: `Are you sure you want to delete the bucket "${bucketName}"? This will permanently delete all files in this bucket. This action cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    };

    const shouldDelete = await confirm(confirmOptions);

    if (shouldDelete) {
      try {
        await deleteBucket(bucketName);
        await refetchBuckets();
        // If the deleted bucket was selected, select the first available bucket
        if (selectedBucket === bucketName) {
          const updatedBuckets =
            queryClient.getQueryData<typeof buckets>(['storage', 'buckets']) || [];
          setSelectedBucket(updatedBuckets[0]?.name || null);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to delete bucket';
        showToast(errorMessage, 'error');
      }
    }
  };

  const handleEditBucket = (bucketName: string) => {
    // Get current bucket's public status
    const info = bucketInfo[bucketName];
    setBucketFormState({
      mode: 'edit',
      name: bucketName,
      isPublic: info?.public ?? false,
    });
    setBucketFormOpen(true);
  };

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((_event: DragEvent<HTMLDivElement>) => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);

      // To support only file uploads (not directories), we filter through
      // dataTransfer.items instead of directly using dataTransfer.files.
      // Ref: https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry
      const fileItems: File[] = Array.from(event.dataTransfer.items)
        .filter((item) => item.webkitGetAsEntry()?.isFile)
        .map((item) => item.getAsFile())
        .filter((item) => item !== null);

      void handleFileUpload(fileItems);
    },
    [handleFileUpload]
  );

  const error = bucketsError;

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      {/* Secondary Sidebar - Bucket List */}
      <StorageSidebar
        buckets={Object.keys(bucketInfo)}
        selectedBucket={selectedBucket || undefined}
        onBucketSelect={setSelectedBucket}
        loading={isLoading}
        onNewBucket={() => {
          setBucketFormState({
            mode: 'create',
            name: null,
            isPublic: true,
          });
          setBucketFormOpen(true);
        }}
        onEditBucket={handleEditBucket}
        onDeleteBucket={(bucketName) => void handleDeleteBucket(bucketName)}
      />

      {/* Main Content Area */}
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => void handleFileSelect(e)}
          className="hidden"
          accept="*"
          style={{ display: 'none' }}
        />

        {selectedBucket && (
          <>
            <TableHeader
              leftContent={
                selectedFiles.size > 0 ? (
                  <div className="flex items-center gap-2">
                    <SelectionClearButton
                      selectedCount={selectedFiles.size}
                      itemType="file"
                      onClear={() => setSelectedFiles(new Set())}
                    />
                    <DeleteActionButton
                      selectedCount={selectedFiles.size}
                      itemType="file"
                      onDelete={() => void handleBulkDeleteFiles(Array.from(selectedFiles))}
                    />
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-3">
                    <h1 className="shrink-0 text-base font-medium leading-7 text-foreground">
                      {selectedBucket}
                    </h1>
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                      <div className="h-5 w-px bg-[var(--alpha-8)]" />
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditBucket(selectedBucket)}
                            className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
                          >
                            <PencilIcon className="h-5 w-5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="center">
                          <p>Edit bucket</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void handleRefresh()}
                            disabled={isRefreshing}
                            className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
                          >
                            <RefreshIcon
                              className={isRefreshing ? 'h-5 w-5 animate-spin' : 'h-5 w-5'}
                            />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="center">
                          <p>{isRefreshing ? 'Refreshing...' : 'Refresh files'}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                      <div className="h-5 w-px bg-[var(--alpha-8)]" />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded px-1.5 text-primary hover:bg-[var(--alpha-4)] hover:text-primary active:bg-[var(--alpha-8)]"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                    >
                      <Upload className="h-5 w-5 stroke-[1.5]" />
                      <span className="px-1 text-sm font-medium leading-5">
                        {isUploading ? 'Uploading...' : 'Upload File'}
                      </span>
                    </Button>
                  </div>
                )
              }
              searchValue={searchValue}
              onSearchChange={setSearchValue}
              searchPlaceholder="Search files"
            />

            {/* Content (supports drag-and-drop file upload) */}
            <div
              className={
                'relative min-h-0 flex-1 flex flex-col overflow-hidden' +
                (isDragging ? ' opacity-25' : '')
              }
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {error && (
                <Alert variant="destructive" className="mx-4 mt-4">
                  <AlertDescription>{String(error)}</AlertDescription>
                </Alert>
              )}

              <StorageManager
                bucketName={selectedBucket}
                fileCount={bucketStats?.[selectedBucket]?.fileCount || 0}
                searchQuery={searchQuery}
                selectedFiles={selectedFiles}
                onSelectedFilesChange={setSelectedFiles}
                isRefreshing={isRefreshing}
              />
            </div>
          </>
        )}
        {!selectedBucket && (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              title="No Bucket Selected"
              description="Select a bucket from the sidebar to view its files"
            />
          </div>
        )}
      </div>

      {/* Bucket Form (handles both create and edit) */}
      <BucketFormDialog
        open={bucketFormOpen}
        onOpenChange={setBucketFormOpen}
        mode={bucketFormState.mode}
        initialBucketName={bucketFormState.name || ''}
        initialIsPublic={bucketFormState.isPublic}
        onSuccess={(bucketName) => {
          void refetchBuckets();
          if (bucketFormState.mode === 'create' && bucketName) {
            setSelectedBucket(bucketName);
          }
        }}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
