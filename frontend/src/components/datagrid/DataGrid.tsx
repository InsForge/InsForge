import '@/rdg.css';
import { useMemo, useCallback } from 'react';
import ReactDataGrid, {
  type Column,
  type SortColumn,
  SelectColumn,
  SELECT_COLUMN_KEY,
  type CellClickArgs,
  type CellMouseEvent,
  type RenderCellProps,
} from 'react-data-grid';
import { cn } from '@/lib/utils/utils';
import { PaginationControls } from '../PaginationControls';
import { Checkbox } from '../Checkbox';
import { useTheme } from '@/lib/contexts/ThemeContext';
import type { DataGridColumn, DataGridRow, DataGridRowType } from './datagridTypes';
import SortableHeaderRenderer from './SortableHeader';

// Generic DataGrid props
export interface DataGridProps<TRow extends DataGridRowType = DataGridRow> {
  data: TRow[];
  columns: DataGridColumn<TRow>[];
  loading?: boolean;
  isSorting?: boolean;
  isRefreshing?: boolean;
  selectedRows?: Set<string>;
  onSelectedRowsChange?: (selectedRows: Set<string>) => void;
  sortColumns?: SortColumn[];
  onSortColumnsChange?: (sortColumns: SortColumn[]) => void;
  onCellClick?: (args: CellClickArgs<TRow>, event: CellMouseEvent) => void;
  currentPage?: number;
  totalPages?: number;
  pageSize?: number;
  totalRecords?: number;
  onPageChange?: (page: number) => void;
  emptyState?: React.ReactNode;
  rowKeyGetter?: (row: TRow) => string;
  className?: string;
  showSelection?: boolean;
  showPagination?: boolean;
  showTypeBadge?: boolean;
  noPadding?: boolean;
}

// Main DataGrid component
export default function DataGrid<TRow extends DataGridRowType = DataGridRow>({
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
  emptyState,
  rowKeyGetter,
  className,
  showSelection = false,
  showPagination = true,
  showTypeBadge = true,
  noPadding = false,
}: DataGridProps<TRow>) {
  const { resolvedTheme } = useTheme();

  const defaultRowKeyGetter = useCallback((row: TRow) => row.id || Math.random().toString(), []);
  const keyGetter = rowKeyGetter || defaultRowKeyGetter;
  // Convert columns to react-data-grid format
  const gridColumns = useMemo(() => {
    const cols: Column<TRow>[] = [];

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
            checked={selectedRows.has(keyGetter(row))}
            onChange={(checked) => {
              const newSelectedRows = new Set(selectedRows);
              if (checked) {
                newSelectedRows.add(String(keyGetter(row)));
              } else {
                newSelectedRows.delete(String(keyGetter(row)));
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

      const gridColumn: Column<TRow> = {
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
        renderCell:
          col.renderCell ||
          (({ row, column }: RenderCellProps<TRow>) => {
            const value = row[column.key];
            const displayValue = String(value ?? '');
            return (
              <div className="w-full h-full flex items-center">
                <span className="truncate dark:text-zinc-300" title={displayValue}>
                  {displayValue}
                </span>
              </div>
            );
          }),
        renderEditCell: col.renderEditCell,
        renderHeaderCell:
          col.renderHeaderCell ||
          (() => (
            <SortableHeaderRenderer<TRow>
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
    keyGetter,
  ]);

  // Loading state - only show full loading screen if not sorting
  if (loading && !isSorting) {
    return (
      <div className="h-full flex items-center justify-center bg-bg-gray dark:bg-neutral-800">
        <div className="text-gray-500 dark:text-zinc-400">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'h-full flex flex-col overflow-hidden bg-bg-gray dark:bg-neutral-800',
        className
      )}
    >
      <div
        className={cn(
          'flex-1 overflow-hidden relative border border-border-gray dark:border-neutral-700 rounded-sm',
          !noPadding && 'mx-3'
        )}
      >
        <ReactDataGrid
          columns={gridColumns}
          rows={isRefreshing ? [] : data}
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
            noRowsFallback: emptyState ? (
              <div className="absolute inset-x-0 top-0 mt-13 py-8 flex items-center justify-center bg-white dark:bg-neutral-800">
                {emptyState}
              </div>
            ) : (
              <div className="absolute inset-x-0 top-0 mt-13 py-8 flex items-center justify-center bg-white dark:bg-neutral-800">
                <div className="text-sm text-zinc-500 dark:text-zinc-400">No data to display</div>
              </div>
            ),
          }}
        />

        {/* Loading mask overlay */}
        {isRefreshing && (
          <div className="absolute inset-0 bg-white dark:bg-neutral-800 flex items-center justify-center z-50 mt-9">
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
