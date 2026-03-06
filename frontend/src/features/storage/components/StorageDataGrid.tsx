import { useMemo } from 'react';
import { Button } from '@insforge/ui';
import {
  DataGrid,
  type DataGridProps,
  type RenderCellProps,
  type DataGridColumn,
  type DataGridRowType,
} from '@/components';
import { Download, Eye, Trash2, Image, FileText, Music, Video, Archive, File } from 'lucide-react';
import { StorageFileSchema } from '@insforge/shared-schemas';
import { cn, formatTime } from '@/lib/utils/utils';

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
      showTypeBadge={false}
      paginationRecordLabel="files"
      rowKeyGetter={(row) => row.key}
    />
  );
}
