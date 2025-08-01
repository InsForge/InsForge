import { useMemo } from 'react';
import { DataGrid, type DataGridColumn, type DataGridProps } from '@/components/DataGrid';
import { Button } from '@/components/radix/Button';
import { Download, Eye, Trash2, Image, FileText, Music, Video, Archive, File } from 'lucide-react';
import { formatDistance } from 'date-fns';
import { type StoredFile } from '@/features/storage/services/storage.service';

// Custom cell renderers for storage files
const FileNameRenderer = ({ row, column }: any) => {
  const fileName = row[column.key].split('/').pop() || row[column.key];
  return (
    <span className="text-sm font-medium text-gray-900 truncate" title={row[column.key]}>
      {fileName}
    </span>
  );
};

const FileSizeRenderer = ({ row, column }: any) => {
  const bytes = row[column.key];

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

  return <span className="text-sm text-gray-600">{formatFileSize(bytes)}</span>;
};

const MimeTypeRenderer = ({ row, column }: any) => {
  const mimeType = row[column.key] || 'Unknown';
  const category = mimeType.split('/')[0];

  // Get appropriate icon based on MIME type category
  const getFileIcon = () => {
    switch (category) {
      case 'image':
        return <Image className="h-4 w-4" />;
      case 'video':
        return <Video className="h-4 w-4" />;
      case 'audio':
        return <Music className="h-4 w-4" />;
      case 'text':
        return <FileText className="h-4 w-4" />;
      case 'application':
        // Check for specific application types
        if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar')) {
          return <Archive className="h-4 w-4" />;
        }
        if (mimeType.includes('pdf')) {
          return <FileText className="h-4 w-4" />;
        }
        return <File className="h-4 w-4" />;
      default:
        return <File className="h-4 w-4" />;
    }
  };

  return (
    <div className="flex items-center gap-2.5">
      {getFileIcon()}
      <span className="text-sm text-gray-500">{mimeType}</span>
    </div>
  );
};

const UploadedAtRenderer = ({ row, column }: any) => {
  const value = row[column.key];
  if (!value) {
    return <span className="text-sm text-gray-500">Unknown</span>;
  }

  const timestamp = value.includes('Z') || value.includes('+') ? value : value + 'Z';

  try {
    return (
      <span className="text-sm text-gray-600">
        {formatDistance(new Date(timestamp), new Date(), { addSuffix: true })}
      </span>
    );
  } catch {
    return <span className="text-sm text-red-500">Invalid date</span>;
  }
};

// Convert storage files data to DataGrid columns
export function createStorageColumns(
  onPreview?: (file: StoredFile) => void,
  onDownload?: (file: StoredFile) => void,
  onDelete?: (file: StoredFile) => void,
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
      key: 'mime_type',
      name: 'Type',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: MimeTypeRenderer,
    },
    {
      key: 'uploaded_at',
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
      renderCell: ({ row }: any) => {
        const isFileDownloading = isDownloading?.(row.key) || false;

        return (
          <div className="flex justify-center">
            {onPreview && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview(row);
                }}
                title="Preview file"
              >
                <Eye className="h-4 w-4" />
              </Button>
            )}
            {onDownload && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload(row);
                }}
                disabled={isFileDownloading}
                title="Download file"
              >
                <Download className="h-4 w-4" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-red-50"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(row);
                }}
                title="Delete file"
              >
                <Trash2 className="h-4 w-4 text-red-600" />
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
  onPreview?: (file: StoredFile) => void;
  onDownload?: (file: StoredFile) => void;
  onDelete?: (file: StoredFile) => void;
  isDownloading?: (key: string) => boolean;
  bucketName?: string; // Used to generate unique storage key
}

// Specialized DataGrid for storage files
export function StorageDataGrid({
  onPreview,
  onDownload,
  onDelete,
  isDownloading,
  bucketName,
  emptyStateTitle = 'No files found',
  emptyStateDescription,
  ...props
}: StorageDataGridProps) {
  const columns = useMemo(
    () => createStorageColumns(onPreview, onDownload, onDelete, isDownloading),
    [onPreview, onDownload, onDelete, isDownloading]
  );

  const defaultEmptyDescription = props.searchQuery
    ? 'No files match your search criteria'
    : 'Upload files to this bucket to see them here';

  // Ensure each row has an id for selection
  const dataWithIds = useMemo(() => {
    return props.data.map((file) => ({
      ...file,
      id: file.key, // Use key as id for selection
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
      rowKeyGetter={(row) => row.key}
      storageKey={bucketName ? `storage-${bucketName}` : 'storage'}
    />
  );
}
