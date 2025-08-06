import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Folder } from 'lucide-react';
import { storageService } from '@/features/storage/services/storage.service';
import { StorageFileSchema } from '@insforge/shared-schemas';
import { LoadingState, ErrorState, EmptyState } from '@/components';
import { StorageDataGrid } from './StorageDataGrid';
import { FilePreviewDialog } from './FilePreviewDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useToast } from '@/lib/hooks/useToast';
import { SortColumn } from 'react-data-grid';

interface StorageManagerProps {
  bucketName: string;
  fileCount: number;
  searchQuery: string;
  selectedFiles: Set<string>;
  onSelectedFilesChange: (selectedFiles: Set<string>) => void;
  isRefreshing?: boolean;
}

export function StorageManager({
  bucketName,
  searchQuery,
  fileCount,
  selectedFiles,
  onSelectedFilesChange,
  isRefreshing = false,
}: StorageManagerProps) {
  const queryClient = useQueryClient();
  const [downloadingFiles, setDownloadingFiles] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<StorageFileSchema | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);
  const { showToast } = useToast();
  const { confirm, ConfirmDialogProps } = useConfirm();

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);

  // Reset page when search query or selected table changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, bucketName]);

  // Fetch objects in selected bucket
  const {
    data: objectsData,
    isLoading: objectsLoading,
    error: objectsError,
  } = useQuery({
    queryKey: ['storage', 'objects', bucketName, currentPage, pageSize, searchQuery],
    queryFn: () =>
      storageService.listObjects(
        bucketName,
        {
          limit: pageSize,
          offset: (currentPage - 1) * pageSize,
        },
        searchQuery
      ),
    enabled: !!bucketName,
    placeholderData: (previousData) => previousData, // Keep previous data while loading
  });

  // Calculate pagination from backend response
  const totalPages = useMemo(() => {
    const total = objectsData?.pagination?.total || fileCount;
    return Math.ceil(total / pageSize);
  }, [objectsData?.pagination?.total, fileCount, pageSize]);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: ({ bucket, key }: { bucket: string; key: string }) =>
      storageService.deleteObject(bucket, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage'] });
    },
  });

  // No need for client-side filtering - backend handles search
  // Just apply sorting
  const processedFiles = useMemo(() => {
    let files = objectsData?.objects || [];

    // Apply sorting
    if (sortColumns.length > 0) {
      const sortColumn = sortColumns[0];
      files = [...files].sort((a, b) => {
        const aValue = a[sortColumn.columnKey as keyof StorageFileSchema];
        const bValue = b[sortColumn.columnKey as keyof StorageFileSchema];

        if (aValue === bValue) {
          return 0;
        }
        if (aValue === null || aValue === undefined) {
          return 1;
        }
        if (bValue === null || bValue === undefined) {
          return -1;
        }

        const result = aValue < bValue ? -1 : 1;
        return sortColumn.direction === 'ASC' ? result : -result;
      });
    }

    return files;
  }, [objectsData?.objects, sortColumns]);

  // Handlers
  const handleDownload = useCallback(
    async (file: StorageFileSchema) => {
      setDownloadingFiles((prev) => new Set(prev).add(file.key));
      try {
        const blob = await storageService.downloadObject(bucketName, file.key);

        // Create download link
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.key.split('/').pop() || file.key;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } catch (error) {
        showToast('Download failed', 'error');
        console.error(error);
      } finally {
        setDownloadingFiles((prev) => {
          const next = new Set(prev);
          next.delete(file.key);
          return next;
        });
      }
    },
    [bucketName, showToast]
  );

  const handlePreview = useCallback((file: StorageFileSchema) => {
    setPreviewFile(file);
    setShowPreviewDialog(true);
  }, []);

  const handleDelete = useCallback(
    async (file: StorageFileSchema) => {
      const confirmOptions = {
        title: 'Delete File',
        description: 'Are you sure you want to delete this file? This action cannot be undone.',
        confirmText: 'Delete',
        destructive: true,
      };

      const shouldDelete = await confirm(confirmOptions);

      if (shouldDelete) {
        deleteMutation.mutate({ bucket: bucketName, key: file.key });
      }
    },
    [bucketName, confirm, deleteMutation]
  );

  const isDownloading = useCallback(
    (key: string) => {
      return downloadingFiles.has(key);
    },
    [downloadingFiles]
  );

  if (!bucketName) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={Folder}
          title="No Bucket Selected"
          description="Select a bucket from the sidebar to view its files"
        />
      </div>
    );
  }

  if (objectsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (objectsError) {
    return (
      <div className="p-6">
        <ErrorState error={objectsError} />
      </div>
    );
  }

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <StorageDataGrid
          data={processedFiles}
          loading={objectsLoading}
          isRefreshing={isRefreshing}
          searchQuery={searchQuery}
          totalRecords={objectsData?.pagination?.total || fileCount}
          selectedRows={selectedFiles}
          onSelectedRowsChange={onSelectedFilesChange}
          sortColumns={sortColumns}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          onSortColumnsChange={setSortColumns}
          onPreview={handlePreview}
          onDownload={(file) => void handleDownload(file)}
          onDelete={(file) => void handleDelete(file)}
          isDownloading={isDownloading}
        />
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog {...ConfirmDialogProps} />

      {/* File Preview Dialog */}
      <FilePreviewDialog
        open={showPreviewDialog}
        onOpenChange={setShowPreviewDialog}
        file={previewFile}
        bucket={bucketName}
      />
    </div>
  );
}
