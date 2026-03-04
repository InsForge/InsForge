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
import { Checkbox } from '@insforge/ui';
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
  selectionHeaderLabel?: string;
  showPagination?: boolean;
  paginationRecordLabel?: string;
  showTypeBadge?: boolean;
  noPadding?: boolean;
  selectionColumnWidth?: number;
  renderSelectionCell?: (props: SelectionCellProps<TRow>) => React.ReactNode;
  renderSelectionHeaderCell?: (props: {
    isAllSelected: boolean;
    isPartiallySelected: boolean;
    onToggle: (checked: boolean | 'indeterminate') => void;
  }) => React.ReactNode;
  headerRowHeight?: number;
  rowHeight?: number;
  gridClassName?: string;
  gridContainerClassName?: string;
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
  selectionHeaderLabel,
  showPagination = true,
  paginationRecordLabel,
  showTypeBadge = true,
  noPadding = true,
  selectionColumnWidth,
  renderSelectionCell,
  renderSelectionHeaderCell,
  headerRowHeight = 32,
  rowHeight = 32,
  gridClassName,
  gridContainerClassName,
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

          return (
            <div className="flex h-full w-full items-center">
              <Checkbox checked={isSelected} onCheckedChange={handleToggle} tabIndex={tabIndex} />
            </div>
          );
        },
        renderHeaderCell: () => {
          const selectedCount = data.filter((row) => selectedRows.has(keyGetter(row))).length;
          const totalCount = data.length;
          const isAllSelected = totalCount > 0 && selectedCount === totalCount;
          const isPartiallySelected = selectedCount > 0 && selectedCount < totalCount;
          const handleSelectionToggle = (checked: boolean | 'indeterminate') => {
            const newSelectedRows = new Set(selectedRows);
            if (checked === true || checked === 'indeterminate') {
              // Select all
              data.forEach((row) => newSelectedRows.add(keyGetter(row)));
            } else {
              // Unselect all
              data.forEach((row) => newSelectedRows.delete(keyGetter(row)));
            }
            onSelectedRowsChange(newSelectedRows);
          };

          if (renderSelectionHeaderCell) {
            return renderSelectionHeaderCell({
              isAllSelected,
              isPartiallySelected,
              onToggle: handleSelectionToggle,
            });
          }

          return (
            <div className="flex h-full w-full items-center gap-2">
              <Checkbox
                checked={isPartiallySelected ? 'indeterminate' : isAllSelected}
                onCheckedChange={handleSelectionToggle}
              />
              {selectionHeaderLabel && (
                <span className="truncate text-[13px] leading-[18px] text-muted-foreground">
                  {selectionHeaderLabel}
                </span>
              )}
            </div>
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
                <span className="truncate text-foreground" title={displayValue}>
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
    renderSelectionHeaderCell,
    selectionHeaderLabel,
  ]);

  // Loading state - only show full loading screen if not sorting
  if (loading && !isSorting) {
    return (
      <div className="flex h-full items-center justify-center bg-[rgb(var(--semantic-1))]">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className={cn('h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]', className)}
    >
      <div className={cn('flex min-h-0 flex-1 overflow-hidden', !noPadding && 'px-3')}>
        <div
          className={cn(
            'relative overflow-hidden bg-[rgb(var(--semantic-1))]',
            rightPanel ? 'rounded-r-none' : 'flex-1',
            gridContainerClassName
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
            className={cn(
              `h-full fill-grid insforge-rdg ${resolvedTheme === 'dark' ? 'rdg-dark' : 'rdg-light'}`,
              gridClassName
            )}
            headerRowHeight={headerRowHeight}
            rowHeight={rowHeight}
            enableVirtualization={true}
            renderers={{
              noRowsFallback: emptyState ? (
                <div
                  className="absolute inset-x-0 bottom-0 flex items-start justify-center bg-semantic-1"
                  style={{ top: headerRowHeight }}
                >
                  {emptyState}
                </div>
              ) : (
                <div
                  className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-semantic-1"
                  style={{ top: headerRowHeight }}
                >
                  <div className="text-sm text-muted-foreground">No data to display</div>
                </div>
              ),
            }}
          />

          {/* Loading mask overlay */}
          {isRefreshing && (
            <div
              className="absolute inset-x-0 bottom-0 z-50 flex items-center justify-center bg-semantic-1"
              style={{ top: headerRowHeight }}
            >
              <div className="flex items-center gap-1">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--alpha-12)] border-t-transparent" />
                <span className="text-sm text-muted-foreground">Loading</span>
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
          recordLabel={paginationRecordLabel}
        />
      )}
    </div>
  );
}
