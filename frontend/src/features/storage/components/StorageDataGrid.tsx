import { useMemo } from 'react';
import {
  DataGrid,
  createDefaultCellRenderer,
  type DataGridProps,
  type RenderCellProps,
  type DataGridColumn,
  type DataGridRowType,
  Button,
} from '@/components';
import { Download, Eye, Trash2, Image, FileText, Music, Video, Archive, File } from 'lucide-react';
import { StorageFileSchema } from '@insforge/shared-schemas';

// Create a type that makes StorageFileSchema compatible with DataGridRowType
// This allows StorageFileSchema to be used with the generic DataGrid while maintaining type safety
type StorageDataGridRow = StorageFileSchema & DataGridRowType;

// Custom cell renderers for storage files
const FileNameRenderer = ({ row, column }: RenderCellProps<StorageDataGridRow>) => {
  const fullPath = String(row[column.key] || '');
  const fileName = fullPath.split('/').pop() || fullPath;
  return (
    <span
      className="text-sm font-medium text-zinc-900 dark:text-zinc-300 truncate"
      title={fullPath}
    >
      {fileName}
    </span>
  );
};

const FileSizeRenderer = ({ row, column }: RenderCellProps<StorageDataGridRow>) => {
  const bytes = Number(row[column.key] || 0);

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

const MimeTypeRenderer = ({ row, column }: RenderCellProps<StorageDataGridRow>) => {
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

// Convert storage files data to DataGrid columns
export function createStorageColumns(
  onPreview?: (file: StorageFileSchema) => void,
  onDownload?: (file: StorageFileSchema) => void,
  onDelete?: (file: StorageFileSchema) => void,
  isDownloading?: (key: string) => boolean
): DataGridColumn<StorageDataGridRow>[] {
  // Create typed cell renderers
  const cellRenderers = createDefaultCellRenderer<StorageDataGridRow>();

  const columns: DataGridColumn<StorageDataGridRow>[] = [
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
      name: 'Uploaded At',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: cellRenderers.datetime,
    },
  ];

  // Add actions column if any handlers are provided
  if (onPreview || onDownload || onDelete) {
    columns.push({
      key: 'actions',
      name: '',
      minWidth: 120,
      maxWidth: 120,
      resizable: false,
      sortable: false,
      renderCell: ({ row }: RenderCellProps<StorageDataGridRow>) => {
        // Type-safe access to the key property
        const fileKey = row.key || String(row['key'] || '');
        const isFileDownloading = isDownloading?.(fileKey) || false;

        return (
          <div className="flex justify-center">
            {onPreview && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview(row as StorageFileSchema);
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
                  onDownload(row as StorageFileSchema);
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
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(row as StorageFileSchema);
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
export interface StorageDataGridProps extends Omit<DataGridProps<StorageDataGridRow>, 'columns'> {
  onPreview?: (file: StorageFileSchema) => void;
  onDownload?: (file: StorageFileSchema) => void;
  onDelete?: (file: StorageFileSchema) => void;
  isDownloading?: (key: string) => boolean;
}

// Specialized DataGrid for storage files
export function StorageDataGrid({
  onPreview,
  onDownload,
  onDelete,
  isDownloading,
  ...props
}: StorageDataGridProps) {
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
      rowKeyGetter={(row) => row.key}
    />
  );
}
