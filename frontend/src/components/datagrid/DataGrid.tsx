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

// Custom selection cell renderer props
export interface SelectionCellProps<TRow extends DataGridRowType = DataGridRow> {
  row: TRow;
  isSelected: boolean;
  onToggle: (checked: boolean) => void;
  tabIndex: number;
}

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
  selectionColumnWidth?: number;
  renderSelectionCell?: (props: SelectionCellProps<TRow>) => React.ReactNode;
  rowClass?: (row: TRow) => string | undefined;
  rightPanel?: React.ReactNode;
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
  selectionColumnWidth,
  renderSelectionCell,
  rowClass,
  rightPanel,
}: DataGridProps<TRow>) {
  const { resolvedTheme } = useTheme();

  const defaultRowKeyGetter = useCallback((row: TRow) => row.id || Math.random().toString(), []);
  const keyGetter = rowKeyGetter || defaultRowKeyGetter;
  // Convert columns to react-data-grid format
  const gridColumns = useMemo(() => {
    const cols: Column<TRow>[] = [];

    // Add selection column if enabled and not hidden
    if (showSelection && selectedRows !== undefined && onSelectedRowsChange) {
      const colWidth = selectionColumnWidth ?? 45;
      cols.push({
        ...SelectColumn,
        key: SELECT_COLUMN_KEY,
        frozen: true,
        width: colWidth,
        minWidth: colWidth,
        maxWidth: renderSelectionCell ? undefined : colWidth,
        resizable: !!renderSelectionCell,
        renderCell: ({ row, tabIndex }) => {
          const isSelected = selectedRows.has(keyGetter(row));
          const handleToggle = (checked: boolean) => {
            const newSelectedRows = new Set(selectedRows);
            if (checked) {
              newSelectedRows.add(String(keyGetter(row)));
            } else {
              newSelectedRows.delete(String(keyGetter(row)));
            }
            onSelectedRowsChange(newSelectedRows);
          };

          if (renderSelectionCell) {
            return renderSelectionCell({ row, isSelected, onToggle: handleToggle, tabIndex });
          }

          return <Checkbox checked={isSelected} onChange={handleToggle} tabIndex={tabIndex} />;
        },
        renderHeaderCell: () => {
          const selectedCount = data.filter((row) => selectedRows.has(keyGetter(row))).length;
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
                  data.forEach((row) => newSelectedRows.add(keyGetter(row)));
                } else {
                  // Unselect all
                  data.forEach((row) => newSelectedRows.delete(keyGetter(row)));
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
    selectionColumnWidth,
    renderSelectionCell,
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
      <div className={cn('flex-1 overflow-hidden flex min-h-0', !noPadding && 'mx-3')}>
        <div
          className={cn(
            'overflow-hidden relative border border-border-gray dark:border-neutral-700 rounded-sm',
            rightPanel ? 'rounded-r-none border-r-0' : 'flex-1'
          )}
          style={rightPanel ? { width: 'calc(100% - 480px)' } : undefined}
        >
          <ReactDataGrid
            key={rightPanel ? 'with-panel' : 'no-panel'}
            columns={gridColumns}
            rows={isRefreshing ? [] : data}
            rowKeyGetter={keyGetter}
            onRowsChange={() => {}}
            selectedRows={selectedRows}
            onSelectedRowsChange={onSelectedRowsChange}
            sortColumns={sortColumns || []}
            onSortColumnsChange={onSortColumnsChange}
            onCellClick={onCellClick}
            rowClass={rowClass}
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
        {rightPanel}
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
