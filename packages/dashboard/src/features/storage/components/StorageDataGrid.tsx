import { useState, useCallback, useMemo, useEffect } from 'react';
import { Button, ConfirmDialog } from '@insforge/ui';
import {
  DataGrid,
  type DataGridProps,
  DataGridEmptyState,
  EmptyState,
  ErrorState,
  LoadingState,
  type RenderCellProps,
  type DataGridColumn,
  type DataGridRowType,
} from '#components';
import {
  Download,
  Eye,
  Trash2,
  Image,
  FileText,
  Music,
  Video,
  Archive,
  File,
  Folder,
} from 'lucide-react';
import { StorageFileSchema } from '@insforge/shared-schemas';
import { cn, formatTime } from '#lib/utils/utils';
import { useStorageObjects } from '#features/storage/hooks/useStorageObjects';
import { FilePreviewDialog } from './FilePreviewDialog';
import { useConfirm } from '#lib/hooks/useConfirm';
import { useToast } from '#lib/hooks/useToast';
import { SortColumn } from 'react-data-grid';
import { usePageSize } from '#lib/hooks/usePageSize';

// Create a type that makes StorageFileSchema compatible with DataGridRowType
// This allows StorageFileSchema to be used with the generic DataGrid while maintaining type safety
type StorageDataGridRow = StorageFileSchema & DataGridRowType;

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Custom cell renderers for storage files
const FileNameRenderer = ({ row, column }: RenderCellProps<StorageDataGridRow>) => {
  const fullPath = String(row[column.key] || '');
  const fileName = fullPath.split('/').pop() || fullPath;
  return (
    <span className="truncate text-[13px] leading-[18px] text-foreground" title={fullPath}>
      {fileName}
    </span>
  );
};

const FileSizeRenderer = ({ row, column }: RenderCellProps<StorageDataGridRow>) => {
  const bytes = Number(row[column.key] || 0);
  return (
    <span className="truncate text-[13px] leading-[18px] text-foreground">
      {formatFileSize(bytes)}
    </span>
  );
};

const MimeTypeRenderer = ({ row, column }: RenderCellProps<StorageDataGridRow>) => {
  const mimeType = String(row[column.key] || 'Unknown');
  const category = mimeType.split('/')[0];

  // Get appropriate icon based on MIME type category
  const getFileIcon = () => {
    switch (category) {
      case 'image':
        return <Image className="h-4 w-4 text-muted-foreground" />;
      case 'video':
        return <Video className="h-4 w-4 text-muted-foreground" />;
      case 'audio':
        return <Music className="h-4 w-4 text-muted-foreground" />;
      case 'text':
        return <FileText className="h-4 w-4 text-muted-foreground" />;
      case 'application':
        // Check for specific application types
        if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar')) {
          return <Archive className="h-4 w-4 text-muted-foreground" />;
        }
        if (mimeType.includes('pdf')) {
          return <FileText className="h-4 w-4 text-muted-foreground" />;
        }
        return <File className="h-4 w-4 text-muted-foreground" />;
      default:
        return <File className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {getFileIcon()}
      <span className="truncate text-[13px] leading-[18px] text-foreground">{mimeType}</span>
    </div>
  );
};

const UploadedAtRenderer = ({ row, column }: RenderCellProps<StorageDataGridRow>) => {
  const rawValue = row[column.key];
  const value = typeof rawValue === 'string' ? rawValue : '';
  const displayValue = value ? formatTime(value) : '—';

  return (
    <span
      className={cn(
        'truncate text-[13px] leading-[18px]',
        value ? 'text-foreground' : 'text-muted-foreground'
      )}
      title={displayValue}
    >
      {displayValue}
    </span>
  );
};

// Convert storage files data to DataGrid columns
export function createStorageColumns(
  onPreview?: (file: StorageFileSchema) => void,
  onDownload?: (file: StorageFileSchema) => void,
  onDelete?: (file: StorageFileSchema) => void,
  isDownloading?: (key: string) => boolean
): DataGridColumn<StorageDataGridRow>[] {
  const columns: DataGridColumn<StorageDataGridRow>[] = [
    {
      key: 'key',
      name: 'Name',
      width: '1.35fr',
      minWidth: 220,
      resizable: true,
      sortable: true,
      renderCell: FileNameRenderer,
    },
    {
      key: 'size',
      name: 'Size',
      width: '0.8fr',
      minWidth: 120,
      resizable: true,
      sortable: true,
      renderCell: FileSizeRenderer,
    },
    {
      key: 'mimeType',
      name: 'Type',
      width: '1.2fr',
      minWidth: 200,
      resizable: true,
      sortable: true,
      renderCell: MimeTypeRenderer,
    },
    {
      key: 'uploadedAt',
      name: 'Uploaded At',
      width: '1.1fr',
      minWidth: 180,
      resizable: true,
      sortable: true,
      renderCell: UploadedAtRenderer,
    },
  ];

  // Add actions column if any handlers are provided
  if (onPreview || onDownload || onDelete) {
    columns.push({
      key: 'actions',
      name: '',
      minWidth: 108,
      maxWidth: 108,
      resizable: false,
      sortable: false,
      renderCell: ({ row }: RenderCellProps<StorageDataGridRow>) => {
        // Type-safe access to the key property
        const fileKey = row.key || String(row['key'] || '');
        const isFileDownloading = isDownloading?.(fileKey) || false;

        return (
          <div className="flex w-full items-center justify-center gap-2">
            {onPreview && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded p-0 text-muted-foreground hover:bg-[var(--alpha-4)] hover:text-foreground active:bg-[var(--alpha-8)]"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview(row as StorageFileSchema);
                }}
                title="Preview file"
              >
                <Eye className="h-5 w-5 stroke-[1.5]" />
              </Button>
            )}
            {onDownload && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded p-0 text-muted-foreground hover:bg-[var(--alpha-4)] hover:text-foreground active:bg-[var(--alpha-8)]"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(row as StorageFileSchema);
                }}
                disabled={isFileDownloading}
                title="Download file"
              >
                <Download className="h-5 w-5 stroke-[1.5]" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded p-0 text-muted-foreground hover:bg-[var(--alpha-4)] hover:text-foreground active:bg-[var(--alpha-8)]"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(row as StorageFileSchema);
                }}
                title="Delete file"
              >
                <Trash2 className="h-5 w-5 stroke-[1.5]" />
              </Button>
            )}
          </div>
        );
      },
    });
  }

  return columns;
}

interface StorageFilesGridProps extends Omit<DataGridProps<StorageDataGridRow>, 'columns'> {
  onPreview?: (file: StorageFileSchema) => void;
  onDownload?: (file: StorageFileSchema) => void;
  onDelete?: (file: StorageFileSchema) => void;
  isDownloading?: (key: string) => boolean;
}

function StorageFilesGrid({
  onPreview,
  onDownload,
  onDelete,
  isDownloading,
  ...props
}: StorageFilesGridProps) {
  const columns = useMemo(
    () => createStorageColumns(onPreview, onDownload, onDelete, isDownloading),
    [onPreview, onDownload, onDelete, isDownloading]
  );

  // Ensure each row has an id for selection
  const dataWithIds = useMemo(() => {
    return props.data.map((file) => ({
      ...file,
      id: file.key, // Use key as id for selection
    }));
  }, [props.data]);

  return (
    <DataGrid<StorageDataGridRow>
      {...props}
      data={dataWithIds}
      columns={columns}
      showSelection={true}
      showPagination={true}
      showTypeBadge={false}
      paginationRecordLabel="files"
      rowKeyGetter={(row) => row.key}
    />
  );
}

export interface StorageDataGridProps {
  bucketName: string;
  fileCount: number;
  searchQuery: string;
  selectedFiles: Set<string>;
  onSelectedFilesChange: (selectedFiles: Set<string>) => void;
  isRefreshing?: boolean;
}

export function StorageDataGrid({
  bucketName,
  searchQuery,
  fileCount,
  selectedFiles,
  onSelectedFilesChange,
  isRefreshing = false,
}: StorageDataGridProps) {
  const [downloadingFiles, setDownloadingFiles] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<StorageFileSchema | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);
  const { showToast } = useToast();
  const { confirm, confirmDialogProps } = useConfirm();
  const [currentPage, setCurrentPage] = useState(1);
  const {
    pageSize,
    pageSizeOptions,
    onPageSizeChange: handlePageSizeChange,
  } = usePageSize('storage');

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, bucketName]);

  const { useListObjects, deleteObjects, downloadObject } = useStorageObjects();
  const {
    data: objectsData,
    isLoading: objectsLoading,
    error: objectsError,
  } = useListObjects(
    bucketName,
    {
      limit: pageSize,
      offset: (currentPage - 1) * pageSize,
    },
    searchQuery
  );

  const totalPages = useMemo(() => {
    const total = objectsData?.pagination.total || fileCount;
    return Math.ceil(total / pageSize);
  }, [objectsData?.pagination.total, fileCount, pageSize]);

  const processedFiles = useMemo(() => {
    let files = objectsData?.objects || [];

    if (sortColumns.length) {
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

  const handleDownload = useCallback(
    async (file: StorageFileSchema) => {
      setDownloadingFiles((prev) => new Set(prev).add(file.key));
      try {
        const blob = await downloadObject(bucketName, file.key);
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
    [bucketName, downloadObject, showToast]
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
        deleteObjects({ bucket: bucketName, keys: [file.key] });
      }
    },
    [bucketName, confirm, deleteObjects]
  );

  const isDownloading = useCallback(
    (key: string) => {
      return downloadingFiles.has(key);
    },
    [downloadingFiles]
  );

  if (!bucketName) {
    return (
      <div className="flex flex-1 items-center justify-center">
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
      <div className="flex flex-1 items-center justify-center">
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
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <StorageFilesGrid
          data={processedFiles}
          loading={objectsLoading}
          isRefreshing={isRefreshing}
          totalRecords={objectsData?.pagination.total || fileCount}
          selectedRows={selectedFiles}
          onSelectedRowsChange={onSelectedFilesChange}
          sortColumns={sortColumns}
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          onPageChange={setCurrentPage}
          onPageSizeChange={(newSize) => {
            handlePageSizeChange(newSize);
            setCurrentPage(1);
          }}
          onSortColumnsChange={setSortColumns}
          onPreview={handlePreview}
          onDownload={(file) => void handleDownload(file)}
          onDelete={(file) => void handleDelete(file)}
          isDownloading={isDownloading}
          emptyState={
            <DataGridEmptyState
              message={searchQuery ? 'No files match your search criteria' : 'No files found'}
            />
          }
        />
      </div>

      <ConfirmDialog {...confirmDialogProps} />

      <FilePreviewDialog
        open={showPreviewDialog}
        onOpenChange={setShowPreviewDialog}
        file={previewFile}
        bucket={bucketName}
      />
    </div>
  );
}
