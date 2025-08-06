import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import PencilIcon from '@/assets/icons/pencil.svg';
import RefreshIcon from '@/assets/icons/refresh.svg';
import { storageService } from '@/features/storage/services/storage.service';
import { Button } from '@/components/radix/Button';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import { StorageSidebar } from '@/features/storage/components/StorageSidebar';
import { StorageManager } from '@/features/storage/components/StorageManager';
import { BucketFormDialog } from '@/features/storage/components/BucketFormDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/radix/Tooltip';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useToast } from '@/lib/hooks/useToast';
import { useUploadToast } from '@/features/storage/components/UploadToast';
import { SearchInput, SelectionClearButton } from '@/components';
import EmptyBucket from '@/assets/icons/empty_bucket.svg';

interface BucketFormState {
  mode: 'create' | 'edit';
  name: string | null;
  isPublic: boolean;
}

export default function StoragePage() {
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
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
  const { confirm, ConfirmDialogProps } = useConfirm();
  const { showToast } = useToast();
  const { showUploadToast, updateUploadProgress, cancelUpload } = useUploadToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);

  // Fetch buckets
  const {
    data: buckets = [],
    isLoading,
    error: bucketsError,
    refetch: refetchBuckets,
  } = useQuery({
    queryKey: ['storage', 'buckets'],
    queryFn: () => storageService.listBuckets(),
  });

  // Fetch bucket statistics
  const { data: bucketStats } = useQuery({
    queryKey: ['storage', 'bucket-stats', buckets],
    queryFn: async () => {
      const stats: Record<
        string,
        { fileCount: number; totalSize: number; public: boolean; createdAt?: string }
      > = {};
      const currentBuckets = buckets;
      const promises = currentBuckets.map(async (bucket) => {
        try {
          const result = await storageService.listObjects(bucket.name, { limit: 1000 });
          const objects = result.objects;
          const totalSize = objects.reduce((sum, file) => sum + file.size, 0);
          return {
            bucketName: bucket.name,
            stats: {
              fileCount: result.pagination.total,
              totalSize: totalSize,
              public: bucket.public,
              createdAt: bucket.createdAt,
            },
          };
        } catch (error) {
          if (error) {
            console.error(error);
            return null;
          }
          return {
            bucketName: bucket.name,
            stats: {
              fileCount: 0,
              totalSize: 0,
              public: bucket.public,
              createdAt: bucket.createdAt,
            },
          };
        }
      });
      const results = await Promise.all(promises);
      results.forEach((result) => {
        if (result) {
          stats[result.bucketName] = result.stats;
        }
      });
      return stats;
    },
    enabled: buckets.length > 0,
    staleTime: 30000, // Cache for 30 seconds
  });

  // Build bucket info map
  const bucketInfo = React.useMemo(() => {
    return bucketStats || {};
  }, [bucketStats]);

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async ({ bucket, file }: { bucket: string; file: File }) => {
      const key = file.name;
      return await storageService.uploadObject(bucket, key, file);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage'] });
    },
    onError: (error: any) => {
      const errorMessage =
        error.response?.data?.error?.message || error.message || 'Failed to upload file';
      showToast(errorMessage, 'error');
    },
  });

  // Auto-select first bucket
  useEffect(() => {
    if (buckets.length > 0 && !selectedBucket) {
      setSelectedBucket(buckets[0].name);
    }
  }, [buckets, selectedBucket]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
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
    if (!selectedBucket || fileKeys.length === 0) {
      return;
    }

    const shouldDelete = await confirm({
      title: `Delete ${fileKeys.length} ${fileKeys.length === 1 ? 'file' : 'files'}`,
      description: `Are you sure you want to delete ${fileKeys.length} ${fileKeys.length === 1 ? 'file' : 'files'}? This action cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });

    if (shouldDelete) {
      try {
        await Promise.all(fileKeys.map((key) => storageService.deleteObject(selectedBucket, key)));
        void queryClient.invalidateQueries({ queryKey: ['storage'] });
        setSelectedFiles(new Set());
        showToast(`${fileKeys.length} files deleted successfully`, 'success');
      } catch {
        showToast('Failed to delete some files', 'error');
      }
    }
    void queryClient.invalidateQueries({ queryKey: ['storage'] });
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0 || !selectedBucket) {
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

    try {
      // Upload files sequentially with progress tracking
      for (let i = 0; i < files.length; i++) {
        if (uploadAbortControllerRef.current?.signal.aborted) {
          break;
        }

        // Update progress
        const progress = Math.round(((i + 1) / files.length) * 100);
        updateUploadProgress(toastId, progress);

        await uploadMutation.mutateAsync({
          bucket: selectedBucket,
          file: files[i],
        });
      }
      showToast('File uploaded successfully', 'success');
    } catch {
      // Error is handled in mutation onError
      cancelUpload(toastId);
    } finally {
      // Always reset uploading state
      setIsUploading(false);
      uploadAbortControllerRef.current = null;

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
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
        await storageService.deleteBucket(bucketName);

        // Refresh buckets list
        await refetchBuckets();
        showToast('Bucket deleted successfully', 'success');

        // If the deleted bucket was selected, select the first available bucket
        if (selectedBucket === bucketName) {
          const updatedBuckets =
            queryClient.getQueryData<typeof buckets>(['storage', 'buckets']) || [];
          setSelectedBucket(updatedBuckets[0]?.name || null);
        }
      } catch (error: any) {
        const errorMessage =
          error.response?.data?.error?.message || error.message || 'Failed to delete bucket';
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

  const error = bucketsError;

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-bg-gray">
      {/* Secondary Sidebar - Bucket List */}
      <StorageSidebar
        buckets={bucketInfo}
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
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {selectedBucket && (
          <>
            {/* Sticky Header Section */}
            <div className="sticky top-0 z-30 bg-bg-gray">
              <div className="px-6 py-3 border-b border-border-gray h-12">
                {/* Page Header with Breadcrumb */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {selectedBucket && (
                      <nav className="flex items-center text-base font-semibold">
                        <span className="text-black">{selectedBucket}</span>
                      </nav>
                    )}

                    {/* Separator */}
                    <div className="h-6 w-px bg-gray-200" />

                    {/* Action buttons group */}
                    <div className="flex items-center gap-3">
                      <TooltipProvider>
                        {selectedBucket && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-zinc-500 hover:text-black"
                                onClick={() => handleEditBucket(selectedBucket)}
                              >
                                <img src={PencilIcon} alt="Pencil Icon" className="h-5 w-5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" align="center">
                              <p>Edit Bucket</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5"
                              onClick={() => void handleRefresh()}
                              disabled={isRefreshing}
                            >
                              <img src={RefreshIcon} alt="Refresh Icon" className="h-5 w-5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" align="center">
                            <p>{isRefreshing ? 'Refreshing...' : 'Refresh'}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-6 py-3 border-b border-border-gray">
                {/* Search Bar and Actions - only show when bucket is selected */}
                {selectedBucket && (
                  <div className="flex items-center justify-between">
                    {selectedFiles.size > 0 ? (
                      <div className="flex items-center gap-3">
                        <SelectionClearButton
                          selectedCount={selectedFiles.size}
                          itemType="file"
                          onClear={() => setSelectedFiles(new Set())}
                        />
                        <Button
                          variant="outline"
                          className="h-10 px-3 text-sm text-red-600 hover:text-red-600 hover:bg-zinc-50 border border-border-gray shadow-0"
                          onClick={() => void handleBulkDeleteFiles(Array.from(selectedFiles))}
                        >
                          Delete {selectedFiles.size} {selectedFiles.size === 1 ? 'File' : 'Files'}
                        </Button>
                      </div>
                    ) : (
                      <SearchInput
                        value={searchQuery}
                        onChange={setSearchQuery}
                        placeholder="Search Files by Name"
                        className="flex-1 max-w-80"
                        debounceTime={300}
                      />
                    )}
                    <div className="flex items-center gap-2 ml-4">
                      {selectedFiles.size === 0 && (
                        <>
                          {/* Upload File Button - moved here when no files selected */}
                          <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            onChange={(e) => void handleFileSelect(e)}
                            className="hidden"
                            accept="*"
                            style={{ display: 'none' }}
                          />
                          <Button
                            className="h-10 px-4 font-medium gap-1.5"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                          >
                            <Upload className="w-5 h-5" />
                            {isUploading ? 'Uploading...' : 'Upload File'}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="relative flex-1 flex flex-col overflow-hidden">
              {error && (
                <Alert variant="destructive" className="mb-4 mx-8 mt-4">
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
              image={EmptyBucket}
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
      <ConfirmDialog {...ConfirmDialogProps} />
    </div>
  );
}
