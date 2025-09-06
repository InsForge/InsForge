import '@/rdg.css';
import React, { useMemo, useState, useCallback } from 'react';
import ReactDataGrid, {
  Column,
  SortColumn,
  SelectColumn,
  SELECT_COLUMN_KEY,
} from 'react-data-grid';
import { Button } from '@/components/radix/Button';
import { Badge } from '@/components/radix/Badge';
import { Copy, Check, ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { cn, formatValueForDisplay } from '@/lib/utils/utils';
import { PaginationControls } from './PaginationControls';
import { Checkbox } from './Checkbox';
import { useTheme } from '@/lib/contexts/ThemeContext';
import { TypeBadge } from './TypeBadge';
import { ColumnType } from '@insforge/shared-schemas';
import type { DatabaseRecord } from '@/lib/types/datagridTypes';
export interface DataGridColumn {
  key: string;
  name: string;
  type?: string;
  width?: number | string;
  minWidth?: number;
  maxWidth?: number;
  resizable?: boolean;
  sortable?: boolean;
  sortDescendingFirst?: boolean;
  editable?: boolean;
  isPrimaryKey?: boolean;
  isNullable?: boolean;
  renderCell?: (props: any) => React.ReactNode;
  renderEditCell?: (props: any) => React.ReactNode;
  renderHeaderCell?: (props: any) => React.ReactNode;
}

export interface DataGridProps {
  data: DatabaseRecord[];
  columns: DataGridColumn[];
  loading?: boolean;
  isSorting?: boolean;
  isRefreshing?: boolean;
  selectedRows?: Set<string>;
  onSelectedRowsChange?: (selectedRows: Set<string>) => void;
  sortColumns?: SortColumn[];
  onSortColumnsChange?: (sortColumns: SortColumn[]) => void;
  onCellEdit?: (rowId: string, columnKey: string, newValue: string) => Promise<void>;
  onCellClick?: (args: any, event: any) => void;
  searchQuery?: string;
  currentPage?: number;
  totalPages?: number;
  pageSize?: number;
  totalRecords?: number;
  onPageChange?: (page: number) => void;
  onDeleteRecord?: (id: string) => void;
  onNewRecord?: () => void;
  emptyStateTitle?: string;
  emptyStateDescription?: string;
  emptyStateActionText?: string;
  onEmptyStateAction?: () => void;
  emptyStateIcon?: React.ReactNode;
  emptyStateAction?: React.ReactNode;
  rowKeyGetter?: (row: any) => string;
  className?: string;
  showSelection?: boolean;
  showPagination?: boolean;
  showTypeBadge?: boolean;
}

// Default cell renderers
export const DefaultCellRenderers = {
  text: ({ row, column }: any) => {
    const value = row[column.key];
    const displayValue = formatValueForDisplay(value, ColumnType.STRING);
    return (
      <div className="w-full h-full flex items-center">
        <span className="truncate dark:text-zinc-300" title={displayValue}>
          {displayValue}
        </span>
      </div>
    );
  },

  boolean: ({ row, column }: any) => {
    const value = row[column.key];
    const displayValue = formatValueForDisplay(value, ColumnType.BOOLEAN);
    return (
      <div className="w-full h-full flex items-center justify-start">
        <Badge
          variant={value ? 'default' : 'secondary'}
          className="border border-transparent dark:bg-neutral-800 dark:text-zinc-300 dark:border-neutral-700"
        >
          {displayValue}
        </Badge>
      </div>
    );
  },

  date: ({ row, column }: any) => {
    const value = row[column.key];
    const displayValue = formatValueForDisplay(value, ColumnType.DATETIME);
    const isError = displayValue === 'Invalid date';

    return (
      <div className="w-full h-full flex items-center">
        <span
          className={cn('truncate', isError ? 'text-red-500' : 'text-black dark:text-zinc-300')}
          title={displayValue}
        >
          {displayValue}
        </span>
      </div>
    );
  },

  json: ({ row, column }: any) => {
    const value = row[column.key];
    const displayText = formatValueForDisplay(value, ColumnType.JSON);

    return (
      <div className="w-full h-full flex items-center">
        <span
          className="truncate text-sm text-black dark:text-zinc-300 max-w-full overflow-hidden whitespace-nowrap"
          title={displayText}
        >
          {displayText}
        </span>
      </div>
    );
  },

  id: ({ row, column }: any) => {
    const value = row[column.key];

    return <IdCell value={value} />;
  },

  email: ({ row, column }: any) => {
    const value = row[column.key];
    const displayValue = formatValueForDisplay(value, ColumnType.STRING);
    return (
      <span
        className="text-sm text-gray-800 font-medium truncate dark:text-zinc-300"
        title={displayValue}
      >
        {displayValue}
      </span>
    );
  },

  badge: ({ row, column, options }: any) => {
    const value = row[column.key];
    const variant = options?.getVariant ? options.getVariant(value) : 'secondary';
    const label = options?.getLabel ? options.getLabel(value) : String(value || '');

    return (
      <div className="w-full h-full flex items-center">
        <Badge variant={variant} className="text-xs dark:bg-neutral-800 dark:text-zinc-300">
          {label}
        </Badge>
      </div>
    );
  },
};
// Separate IdCell component to use hooks properly
function IdCell({ value }: { value: any }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Copy failed silently
    }
  };

  return (
    <div className="w-full h-full flex items-center justify-between group">
      <span className="text-sm truncate" title={String(value)}>
        {value}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-1 bg-white dark:bg-neutral-700 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          handleCopy(e).catch(() => {
            // Handle copy error silently
          });
        }}
      >
        {copied ? (
          <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
        ) : (
          <Copy className="h-5 w-5 text-black dark:text-white" />
        )}
      </Button>
    </div>
  );
}

// Default header renderer
export function SortableHeaderRenderer({
  column,
  sortDirection,
  columnType,
  showTypeBadge,
  mutedHeader,
}: {
  column: any;
  sortDirection?: 'ASC' | 'DESC';
  columnType?: string;
  showTypeBadge?: boolean;
  mutedHeader?: boolean;
}) {
  // Determine which arrow to show on hover based on current sort state
  const getNextSortDirection = () => {
    if (!sortDirection) {
      return 'DESC'; // Default to DESC for first sort
    } else if (sortDirection === 'ASC') {
      return null;
    } else {
      return 'ASC';
    }
  };

  const nextDirection = getNextSortDirection();

  return (
    <div className="group w-full h-full flex items-center cursor-pointer">
      <div className="flex flex-row gap-1 items-center">
        <span
          className={`truncate text-sm font-medium ${mutedHeader ? 'text-zinc-500 dark:text-neutral-400' : 'text-zinc-950 dark:text-zinc-300'} max-w-[120px]`}
          title={column.name}
        >
          {column.name}
        </span>

        {columnType && showTypeBadge && (
          <TypeBadge type={columnType} className="dark:bg-neutral-800" />
        )}

        {/* Show sort arrow with hover effect */}
        {column.sortable && (
          <div className="relative ml-0.5 w-5 h-5">
            {sortDirection && (
              <div className="bg-transparent p-0.5 rounded">
                {sortDirection === 'DESC' ? (
                  <ArrowDownWideNarrow className="h-4 w-4 text-zinc-500 dark:text-neutral-400 transition-opacity group-hover:opacity-0" />
                ) : (
                  <ArrowUpNarrowWide className="h-4 w-4 text-zinc-500 dark:text-neutral-400 transition-opacity group-hover:opacity-0" />
                )}
              </div>
            )}

            {nextDirection && (
              <div className="absolute inset-0 invisible group-hover:visible transition-opacity bg-slate-200 border border-slate-200 dark:bg-neutral-800 dark:border-neutral-800 p-0.5 rounded w-5 h-5">
                {nextDirection === 'DESC' ? (
                  <ArrowDownWideNarrow className="h-4 w-4 text-zinc-500 dark:text-neutral-400" />
                ) : (
                  <ArrowUpNarrowWide className="h-4 w-4 text-zinc-500 dark:text-neutral-400" />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Main DataGrid component
export function DataGrid({
  data,
  columns,
  loading = false,
  isSorting = false,
  isRefreshing = false,
  selectedRows,
  onSelectedRowsChange,
  sortColumns,
  onSortColumnsChange,
  // onCellEdit,
  onCellClick,
  searchQuery: _searchQuery,
  currentPage,
  totalPages,
  pageSize,
  totalRecords,
  onPageChange,
  onDeleteRecord: _onDeleteRecord,
  onNewRecord: _onNewRecord,
  emptyStateTitle = 'No data available',
  emptyStateDescription: _emptyStateDescription,
  emptyStateActionText,
  onEmptyStateAction,
  emptyStateIcon: _emptyStateIcon,
  emptyStateAction: _emptyStateAction,
  rowKeyGetter,
  className,
  showSelection = false,
  showPagination = true,
  showTypeBadge = true,
}: DataGridProps) {
  const { resolvedTheme } = useTheme();
  // Convert columns to react-data-grid format
  const gridColumns = useMemo(() => {
    const cols: Column<any>[] = [];

    // Add selection column if enabled and not hidden
    if (showSelection && selectedRows !== undefined && onSelectedRowsChange) {
      cols.push({
        ...SelectColumn,
        key: SELECT_COLUMN_KEY,
        frozen: true,
        width: 45,
        minWidth: 45,
        maxWidth: 45,
        resizable: false,
        renderCell: ({ row, tabIndex }) => (
          <Checkbox
            checked={selectedRows.has(String(row.id))}
            onChange={(checked) => {
              const newSelectedRows = new Set(selectedRows);
              if (checked) {
                newSelectedRows.add(String(row.id));
              } else {
                newSelectedRows.delete(String(row.id));
              }
              onSelectedRowsChange(newSelectedRows);
            }}
            tabIndex={tabIndex}
          />
        ),
        renderHeaderCell: () => {
          const selectedCount = data.filter((row) => selectedRows.has(String(row.id))).length;
          const totalCount = data.length;
          const isAllSelected = totalCount > 0 && selectedCount === totalCount;
          const isPartiallySelected = selectedCount > 0 && selectedCount < totalCount;

          return (
            <Checkbox
              checked={isAllSelected}
              indeterminate={isPartiallySelected}
              onChange={(checked) => {
                const newSelectedRows = new Set(selectedRows);
                if (checked) {
                  // Select all
                  data.forEach((row) => newSelectedRows.add(String(row.id)));
                } else {
                  // Unselect all
                  data.forEach((row) => newSelectedRows.delete(String(row.id)));
                }
                onSelectedRowsChange(newSelectedRows);
              }}
            />
          );
        },
      });
    }

    // Add data columns
    columns.forEach((col) => {
      const currentSort = sortColumns?.find((sort) => sort.columnKey === col.key);
      const sortDirection = currentSort?.direction;

      const gridColumn: Column<any> = {
        ...col,
        key: col.key,
        name: col.name,
        width: col.width,
        minWidth: col.minWidth || 80,
        maxWidth: col.maxWidth,
        resizable: col.resizable !== false,
        sortable: col.sortable !== false,
        sortDescendingFirst: col.sortDescendingFirst ?? true,
        editable: col.editable && !col.isPrimaryKey,
        renderCell: col.renderCell || DefaultCellRenderers.text,
        renderEditCell: col.renderEditCell,
        renderHeaderCell:
          col.renderHeaderCell ||
          (({ column }: { column: any }) => (
            <SortableHeaderRenderer
              column={column}
              sortDirection={sortDirection}
              columnType={col.type}
              showTypeBadge={showTypeBadge}
            />
          )),
      };

      cols.push(gridColumn);
    });

    return cols;
  }, [
    columns,
    selectedRows,
    onSelectedRowsChange,
    data,
    sortColumns,
    showSelection,
    showTypeBadge,
  ]);

  // Default row key getter
  const defaultRowKeyGetter = useCallback(
    (row: any) => row.id || row.key || Math.random().toString(),
    []
  );
  const keyGetter = rowKeyGetter || defaultRowKeyGetter;

  // Loading state - only show full loading screen if not sorting
  if (loading && !isSorting) {
    return (
      <div className="h-full flex items-center justify-center bg-white dark:bg-neutral-800">
        <div className="text-gray-500 dark:text-zinc-400">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'h-full flex flex-col bg-bg-gray dark:bg-neutral-800 overflow-hidden',
        className
      )}
    >
      <div className="flex-1 overflow-hidden relative mx-3 rounded-lg border border-border-gray dark:border-0">
        <ReactDataGrid
          columns={gridColumns}
          rows={data || []}
          rowKeyGetter={keyGetter}
          onRowsChange={() => {}}
          selectedRows={selectedRows}
          onSelectedRowsChange={onSelectedRowsChange}
          sortColumns={sortColumns || []}
          onSortColumnsChange={onSortColumnsChange}
          onCellClick={onCellClick}
          className={`h-full fill-grid ${resolvedTheme === 'dark' ? 'rdg-dark' : 'rdg-light'}`}
          headerRowHeight={36}
          rowHeight={36}
          enableVirtualization={true}
          renderers={{
            noRowsFallback: (
              <div className="absolute inset-x-0 top-0 mt-13 py-8 flex items-center justify-center bg-white dark:bg-neutral-800">
                <div className="flex flex-row gap-2.5 items-center">
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">{emptyStateTitle}</div>
                  {emptyStateActionText && onEmptyStateAction && (
                    <button
                      onClick={onEmptyStateAction}
                      className="inline-flex items-center text-sm font-medium text-chart-blue-dark focus:outline-none focus:ring-0 dark:text-zinc-400"
                    >
                      {emptyStateActionText}
                    </button>
                  )}
                </div>
              </div>
            ),
          }}
        />

        {/* Loading mask overlay */}
        {isRefreshing && (
          <div className="absolute inset-0 bg-white/60 dark:bg-neutral-800/60 flex items-center justify-center z-50 mt-13">
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 border-2 border-zinc-500 dark:border-neutral-700 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">Loading</span>
            </div>
          </div>
        )}
      </div>
      {showPagination && onPageChange && (
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
          totalRecords={totalRecords}
          pageSize={pageSize}
        />
      )}
    </div>
  );
}
