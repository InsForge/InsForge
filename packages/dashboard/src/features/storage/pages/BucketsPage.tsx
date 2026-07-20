import React, { useState, useEffect, useRef, useCallback, useMemo, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import PencilIcon from '#assets/icons/pencil.svg?react';
import RefreshIcon from '#assets/icons/refresh.svg?react';
import { useBuckets } from '#features/storage/hooks/useBuckets';
import { useStorageObjects } from '#features/storage/hooks/useStorageObjects';
import { storageService } from '#features/storage/services/storage.service';
import { nextAvailableObjectKey } from '#features/storage/helpers';
import { StorageSidebar } from '#features/storage/components/StorageSidebar';
import { StorageDataGrid } from '#features/storage/components/StorageDataGrid';
import { BucketFormDialog } from '#features/storage/components/BucketFormDialog';

import { useConfirm } from '#lib/hooks/useConfirm';
import {
  useToast,
  useUploadToast,
  Button,
  ConfirmDialog,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@insforge/ui';
import { useSearchParams } from 'react-router-dom';
import {
  SelectionClearButton,
  DeleteActionButton,
  Alert,
  AlertDescription,
  TableHeader,
  DataGridEmptyState,
} from '#components';

interface BucketFormState {
  mode: 'create' | 'edit';
  name: string | null;
  isPublic: boolean;
}

export default function BucketsPage() {
  const { t } = useTranslation('chrome');
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedBucketFromQuery = searchParams.get('bucket')?.trim();
  const [searchValue, setSearchValue] = useState('');
  const searchQuery = searchValue.trim();
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
    deleteBucket,
  } = useBuckets();
  const { uploadObject, deleteObjects } = useStorageObjects();
  const selectedBucket = useMemo(() => {
    if (isLoading || !buckets.length) {
      return null;
    }

    if (
      selectedBucketFromQuery &&
      buckets.some((bucket) => bucket.name === selectedBucketFromQuery)
    ) {
      return selectedBucketFromQuery;
    }

    return buckets[0].name;
  }, [isLoading, buckets, selectedBucketFromQuery]);

  const selectBucket = useCallback(
    (bucketName: string | null, replace: boolean = false) => {
      const nextSearchParams = new URLSearchParams(searchParams);
      if (bucketName) {
        nextSearchParams.set('bucket', bucketName);
      } else {
        nextSearchParams.delete('bucket');
      }
      setSearchParams(nextSearchParams, { replace });
    },
    [searchParams, setSearchParams]
  );

  const { data: bucketStats } = useBucketStats();

  // Build bucket info map
  const bucketInfo = React.useMemo(() => {
    return bucketStats || {};
  }, [bucketStats]);

  // Keep URL query param in sync with active bucket selection with fallback-to-first behavior.
  useEffect(() => {
    if (isLoading) {
      return;
    }

    if ((selectedBucketFromQuery ?? null) === selectedBucket) {
      return;
    }

    selectBucket(selectedBucket, true);
  }, [selectedBucketFromQuery, isLoading, selectedBucket, selectBucket]);

  // Clear selected files when switching buckets
  useEffect(() => {
    setSelectedFiles(new Set());
  }, [selectedBucket]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      setSelectedFiles(new Set());
      setSearchValue('');
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
      title: t('storage.deleteFilesTitle', {
        count: fileKeys.length,
        defaultValue_one: 'Delete {{count}} file',
        defaultValue_other: 'Delete {{count}} files',
      }),
      description: t('storage.deleteFilesDescription', {
        count: fileKeys.length,
        defaultValue_one:
          'Are you sure you want to delete {{count}} file? This action cannot be undone.',
        defaultValue_other:
          'Are you sure you want to delete {{count}} files? This action cannot be undone.',
      }),
      confirmText: t('storage.delete', { defaultValue: 'Delete' }),
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

    // The storage API replaces on an existing key (standard PUT, no server-side
    // rename), so the dashboard's friendly auto-rename is done here: before each
    // upload we pick the next free "name (N).ext" so a duplicate filename never
    // silently overwrites an existing object. `takenInBatch` also reserves keys
    // chosen earlier in this multi-file upload, since the object listing won't
    // reflect them yet. A concurrent upload from another client between the list
    // and the PUT could still take the key (then PUT replaces it) — an accepted
    // trade-off for this admin flow over a conditional-write round-trip.
    const uploadWithAutoRename = async (bucket: string, file: File, takenInBatch: Set<string>) => {
      const lastDotIndex = file.name.lastIndexOf('.');
      const baseName = lastDotIndex > 0 ? file.name.slice(0, lastDotIndex) : file.name;
      const { objects } = await storageService.listObjects(bucket, { limit: 1000 }, baseName);
      const objectKey = nextAvailableObjectKey(
        [...objects.map((object) => object.key), ...takenInBatch],
        file.name
      );
      takenInBatch.add(objectKey);
      await uploadObject({ bucket, objectKey, file });
    };

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
    // Keys already assigned earlier in this batch, so two files with the same
    // name don't collide before the listing catches up.
    const takenInBatch = new Set<string>();

    // Upload files sequentially with individual error handling
    for (let i = 0; i < files.length; i++) {
      if (uploadAbortControllerRef.current?.signal.aborted) {
        break;
      }

      // Update progress
      const progress = Math.round(((i + 1) / files.length) * 100);
      updateUploadProgress(toastId, progress);

      try {
        await uploadWithAutoRename(selectedBucket, files[i], takenInBatch);
        successCount++;
      } catch (error) {
        // Handle individual file upload error
        const fileName = files[i].name;

        // Show individual file error (but don't stop the overall process)
        const errorMessage =
          error instanceof Error
            ? error.message
            : t('storage.uploadFailed', { defaultValue: 'Upload failed' });
        showToast(
          t('storage.failedToUploadFile', {
            defaultValue: 'Failed to upload "{{fileName}}": {{errorMessage}}',
            fileName,
            errorMessage,
          }),
          'error'
        );
      }
    }
    showToast(
      t('storage.filesUploadedSuccessfully', {
        count: successCount,
        defaultValue_one: '{{count}} file uploaded successfully',
        defaultValue_other: '{{count}} files uploaded successfully',
      }),
      'success'
    );

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
    t,
  ]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await handleFileUpload(event.target.files);
  };

  const handleDeleteBucket = async (bucketName: string) => {
    const confirmOptions = {
      title: t('storage.deleteBucket', { defaultValue: 'Delete Bucket' }),
      description: t('storage.deleteBucketDescription', {
        defaultValue:
          'Are you sure you want to delete the bucket "{{bucketName}}"? This will permanently delete all files in this bucket. This action cannot be undone.',
        bucketName,
      }),
      confirmText: t('storage.delete', { defaultValue: 'Delete' }),
      destructive: true,
    };

    const shouldDelete = await confirm(confirmOptions);

    if (shouldDelete) {
      try {
        await deleteBucket(bucketName);
        await refetchBuckets();
        // Update selected bucket in URL BEFORE delete flow settles.
        if (selectedBucket === bucketName) {
          const nextBucket = buckets.find((bucket) => bucket.name !== bucketName)?.name ?? null;
          selectBucket(nextBucket, true);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : t('storage.failedToDeleteBucket', { defaultValue: 'Failed to delete bucket' });
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
        onBucketSelect={(bucketName) => selectBucket(bucketName)}
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
                          <p>{t('storage.editBucketTooltip', { defaultValue: 'Edit bucket' })}</p>
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
                          <p>
                            {isRefreshing
                              ? t('storage.refreshing', { defaultValue: 'Refreshing...' })
                              : t('storage.refreshFiles', { defaultValue: 'Refresh files' })}
                          </p>
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
                        {isUploading
                          ? t('storage.uploading', { defaultValue: 'Uploading...' })
                          : t('storage.uploadFile', { defaultValue: 'Upload File' })}
                      </span>
                    </Button>
                  </div>
                )
              }
              searchValue={searchValue}
              onSearchChange={setSearchValue}
              searchDebounceTime={300}
              searchPlaceholder={t('storage.searchFiles', { defaultValue: 'Search files' })}
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

              <StorageDataGrid
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
          <div className="flex flex-1 items-center justify-center">
            <DataGridEmptyState
              message={t('storage.noBucketSelected', { defaultValue: 'No bucket selected' })}
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
            selectBucket(bucketName);
          }
        }}
      />
      {/* Confirm Dialog */}
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
