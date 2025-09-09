import '@/rdg.css';
import { useMemo, useCallback } from 'react';
import ReactDataGrid, {
  type Column,
  type SortColumn,
  SelectColumn,
  SELECT_COLUMN_KEY,
  type CellClickArgs,
  type CellMouseEvent,
} from 'react-data-grid';
import { cn } from '@/lib/utils/utils';
import { PaginationControls } from '../PaginationControls';
import { Checkbox } from '../Checkbox';
import { useTheme } from '@/lib/contexts/ThemeContext';
import type { DataGridColumn, DataGridRow } from './datagridTypes';
import SortableHeaderRenderer from './SortableHeader';
import { DefaultCellRenderers } from './DefaultCells';

// Default cell renderers
export interface DataGridProps {
  data: DataGridRow[];
  columns: DataGridColumn[];
  loading?: boolean;
  isSorting?: boolean;
  isRefreshing?: boolean;
  selectedRows?: Set<string>;
  onSelectedRowsChange?: (selectedRows: Set<string>) => void;
  sortColumns?: SortColumn[];
  onSortColumnsChange?: (sortColumns: SortColumn[]) => void;
  onCellClick?: (args: CellClickArgs<DataGridRow>, event: CellMouseEvent) => void;
  currentPage?: number;
  totalPages?: number;
  pageSize?: number;
  totalRecords?: number;
  onPageChange?: (page: number) => void;
  emptyStateTitle?: string;
  emptyStateDescription?: string;
  emptyStateActionText?: string;
  onEmptyStateAction?: () => void;
  rowKeyGetter?: (row: DataGridRow) => string;
  className?: string;
  showSelection?: boolean;
  showPagination?: boolean;
  showTypeBadge?: boolean;
}

// Main DataGrid component
export default function DataGrid({
  data,
  columns,
  loading = false,
  isSorting = false,
  isRefreshing = false,
  selectedRows,
  onSelectedRowsChange,
  sortColumns,
  onSortColumnsChange,
  onCellClick,
  currentPage,
  totalPages,
  pageSize,
  totalRecords,
  onPageChange,
  emptyStateTitle = 'No data available',
  emptyStateDescription,
  emptyStateActionText,
  onEmptyStateAction,
  rowKeyGetter,
  className,
  showSelection = false,
  showPagination = true,
  showTypeBadge = true,
}: DataGridProps) {
  const { resolvedTheme } = useTheme();
  // Convert columns to react-data-grid format
  const gridColumns = useMemo(() => {
    const cols: Column<DataGridRow>[] = [];

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

      const gridColumn: Column<DataGridRow> = {
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
          (() => (
            <SortableHeaderRenderer
              column={col}
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
    (row: DataGridRow) => row.id || Math.random().toString(),
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
                <div className="flex flex-col gap-1 items-center">
                  <div className="flex flex-row gap-2.5 items-center">
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                      {emptyStateTitle}
                    </div>
                    {emptyStateActionText && onEmptyStateAction && (
                      <button
                        onClick={onEmptyStateAction}
                        className="inline-flex items-center text-sm font-medium text-chart-blue-dark focus:outline-none focus:ring-0 dark:text-zinc-400"
                      >
                        {emptyStateActionText}
                      </button>
                    )}
                  </div>
                  {emptyStateDescription && (
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                      {emptyStateDescription}
                    </div>
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
