import { useMemo } from 'react';
import { DataGrid, type DataGridProps } from '@/components/DataGrid';
import type { DataGridColumn, DataGridRow } from '@/lib/types/datagridTypes';
import type { RenderCellProps } from 'react-data-grid';
import { Button } from '@/components/radix/Button';
import { Download, Eye, Trash2, Image, FileText, Music, Video, Archive, File } from 'lucide-react';
import { formatDistance } from 'date-fns';
import { StorageFileSchema } from '@insforge/shared-schemas';

// Custom cell renderers for storage files
const FileNameRenderer = ({ row, column }: RenderCellProps<DataGridRow>) => {
  const fileName = String(row[column.key]).split('/').pop() || String(row[column.key]);
  return (
    <span
      className="text-sm font-medium text-zinc-900 dark:text-zinc-300 truncate"
      title={String(row[column.key])}
    >
      {fileName}
    </span>
  );
};

const FileSizeRenderer = ({ row, column }: RenderCellProps<DataGridRow>) => {
  const bytes = Number(row[column.key]);

  const formatFileSize = (bytes: number) => {
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
  };

  return <span className="text-sm text-zinc-600 dark:text-zinc-300">{formatFileSize(bytes)}</span>;
};

const MimeTypeRenderer = ({ row, column }: RenderCellProps<DataGridRow>) => {
  const mimeType = String(row[column.key] || 'Unknown');
  const category = mimeType.split('/')[0];

  // Get appropriate icon based on MIME type category
  const getFileIcon = () => {
    switch (category) {
      case 'image':
        return <Image className="h-4 w-4 text-zinc-950 dark:text-zinc-300" />;
      case 'video':
        return <Video className="h-4 w-4 text-zinc-950 dark:text-zinc-300" />;
      case 'audio':
        return <Music className="h-4 w-4 text-zinc-950 dark:text-zinc-300" />;
      case 'text':
        return <FileText className="h-4 w-4 text-zinc-950 dark:text-zinc-300" />;
      case 'application':
        // Check for specific application types
        if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar')) {
          return <Archive className="h-4 w-4 text-zinc-950 dark:text-zinc-300" />;
        }
        if (mimeType.includes('pdf')) {
          return <FileText className="h-4 w-4 text-zinc-950 dark:text-zinc-300" />;
        }
        return <File className="h-4 w-4 text-zinc-950 dark:text-zinc-300" />;
      default:
        return <File className="h-4 w-4 text-zinc-950 dark:text-zinc-300" />;
    }
  };

  return (
    <div className="flex items-center gap-2.5">
      {getFileIcon()}
      <span className="text-sm text-zinc-500 dark:text-zinc-300">{mimeType}</span>
    </div>
  );
};

const UploadedAtRenderer = ({ row, column }: RenderCellProps<DataGridRow>) => {
  const value = row[column.key];
  if (!value) {
    return <span className="text-sm text-zinc-500 dark:text-zinc-300">Unknown</span>;
  }

  const timestamp =
    String(value).includes('Z') || String(value).includes('+')
      ? String(value)
      : String(value) + 'Z';

  try {
    return (
      <span className="text-sm text-zinc-600 dark:text-zinc-300">
        {formatDistance(new Date(timestamp), new Date(), { addSuffix: true })}
      </span>
    );
  } catch {
    return <span className="text-sm text-red-500 dark:text-red-400">Invalid date</span>;
  }
};

// Convert storage files data to DataGrid columns
export function createStorageColumns(
  onPreview?: (file: StorageFileSchema) => void,
  onDownload?: (file: StorageFileSchema) => void,
  onDelete?: (file: StorageFileSchema) => void,
  isDownloading?: (key: string) => boolean
): DataGridColumn[] {
  const columns: DataGridColumn[] = [
    {
      key: 'key',
      name: 'Name',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: FileNameRenderer,
    },
    {
      key: 'size',
      name: 'Size',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: FileSizeRenderer,
    },
    {
      key: 'mimeType',
      name: 'Type',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: MimeTypeRenderer,
    },
    {
      key: 'uploadedAt',
      name: 'Uploaded',
      width: '1fr',
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
      maxWidth: 120,
      resizable: false,
      sortable: false,
      renderCell: ({ row }: RenderCellProps<DataGridRow>) => {
        const isFileDownloading = isDownloading?.(String(row.key)) || false;

        return (
          <div className="flex justify-center">
            {onPreview && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview(row as unknown as StorageFileSchema);
                }}
                title="Preview file"
              >
                <Eye className="h-4 w-4 text-zinc-500 dark:text-zinc-300" />
              </Button>
            )}
            {onDownload && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(row as unknown as StorageFileSchema);
                }}
                disabled={isFileDownloading}
                title="Download file"
              >
                <Download className="h-4 w-4 text-zinc-500 dark:text-zinc-300" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-red-50"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(row as unknown as StorageFileSchema);
                }}
                title="Delete file"
              >
                <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
              </Button>
            )}
          </div>
        );
      },
    });
  }

  return columns;
}

// Storage-specific DataGrid props
export interface StorageDataGridProps extends Omit<DataGridProps, 'columns'> {
  searchQuery?: string;
  onPreview?: (file: StorageFileSchema) => void;
  onDownload?: (file: StorageFileSchema) => void;
  onDelete?: (file: StorageFileSchema) => void;
  isDownloading?: (key: string) => boolean;
}

// Specialized DataGrid for storage files
export function StorageDataGrid({
  searchQuery,
  onPreview,
  onDownload,
  onDelete,
  isDownloading,
  emptyStateTitle = 'No files found',
  emptyStateDescription,
  ...props
}: StorageDataGridProps) {
  const columns = useMemo(
    () => createStorageColumns(onPreview, onDownload, onDelete, isDownloading),
    [onPreview, onDownload, onDelete, isDownloading]
  );

  const defaultEmptyDescription = searchQuery
    ? 'No files match your search criteria'
    : 'Upload files to this bucket to see them here';

  // Ensure each row has an id for selection
  const dataWithIds = useMemo(() => {
    return props.data.map((file) => ({
      ...file,
      id: String(file.key), // Use key as id for selection
    }));
  }, [props.data]);

  return (
    <DataGrid
      {...props}
      data={dataWithIds}
      columns={columns}
      emptyStateTitle={emptyStateTitle}
      emptyStateDescription={emptyStateDescription || defaultEmptyDescription}
      showSelection={true}
      showPagination={true}
      rowKeyGetter={(row) => String(row.key)}
    />
  );
}
