import { useMemo, useCallback } from 'react';
import {
  DataGrid,
  type DataGridProps,
  type RenderCellProps,
  type RenderHeaderCellProps,
  type DataGridColumn,
  type DataGridRowType,
} from '#components/datagrid';
import type { CellClickArgs, CellMouseEvent } from 'react-data-grid';

// Cell props exposed to a column's renderCell, with the row narrowed to the
// consumer's row type T. The grid itself operates on the loose DataGridRowType
// (it needs the index signature); createLogsColumns bridges the two.
export type LogsCellProps<T extends object> = Omit<RenderCellProps<DataGridRowType>, 'row'> & {
  row: T;
};

// Column definition type for LogsDataGrid
export interface LogsColumnDef<T extends object = DataGridRowType> {
  key: string;
  name: string;
  width?: string;
  minWidth?: number;
  maxWidth?: number;
  sortable?: boolean;
  renderCell?: (props: LogsCellProps<T>) => React.ReactNode;
  renderHeaderCell?: (props: RenderHeaderCellProps<DataGridRowType>) => React.ReactNode;
}

// Convert logs data to DataGrid columns with custom renderers
export function createLogsColumns<T extends object = DataGridRowType>(
  columnDefs: LogsColumnDef<T>[]
): DataGridColumn<DataGridRowType>[] {
  return columnDefs.map((def) => {
    const renderCell = (props: RenderCellProps<DataGridRowType>) => {
      if (def.renderCell) {
        // Single boundary cast: the grid's rows are the consumer's T at runtime.
        return def.renderCell({ ...props, row: props.row as unknown as T });
      }
      const value = props.row[props.column.key];
      return (
        <span className="truncate text-[13px] font-normal leading-[18px] text-[rgb(var(--foreground))]">
          {String(value ?? '')}
        </span>
      );
    };

    const baseHeaderRenderer =
      def.renderHeaderCell ||
      (({ column }: RenderHeaderCellProps<DataGridRowType>) => (
        <span
          className="truncate text-[13px] leading-[18px] text-muted-foreground"
          title={typeof column.name === 'string' ? column.name : ''}
        >
          {column.name}
        </span>
      ));

    const column: DataGridColumn<DataGridRowType> = {
      key: def.key,
      name: def.name,
      width: def.width || '1fr',
      minWidth: def.minWidth,
      maxWidth: def.maxWidth,
      resizable: true,
      sortable: false,
      renderCell,
      renderHeaderCell: (props: RenderHeaderCellProps<DataGridRowType>) =>
        baseHeaderRenderer(props),
    };

    return column;
  });
}

// Logs-specific DataGrid props - generic to accept any object type
export interface LogsDataGridProps<T extends object = Record<string, unknown>> extends Omit<
  DataGridProps<DataGridRowType>,
  'columns' | 'data'
> {
  columnDefs: LogsColumnDef<T>[];
  data: T[];
  noPadding?: boolean;
  selectedRowId?: string | null;
  onRowClick?: (row: T) => void;
  rightPanel?: React.ReactNode;
}

// Specialized DataGrid for logs
export function LogsDataGrid<T extends object = Record<string, unknown>>({
  columnDefs,
  data,
  noPadding,
  selectedRowId,
  onRowClick,
  rightPanel,
  ...restProps
}: LogsDataGridProps<T>) {
  const columns = useMemo(() => {
    return createLogsColumns<T>(columnDefs);
  }, [columnDefs]);

  // Ensure each row has an id for DataGrid compatibility
  const dataWithIds = useMemo(() => {
    return data.map((log, index) => {
      const record = log as Record<string, unknown>;
      return {
        ...record,
        id: String(record.id ?? index),
      };
    }) as DataGridRowType[];
  }, [data]);

  // Handle cell click to trigger row click
  const handleCellClick = useCallback(
    (args: CellClickArgs<DataGridRowType>, _event: CellMouseEvent) => {
      if (onRowClick) {
        onRowClick(args.row as T);
      }
    },
    [onRowClick]
  );

  // Row class for highlighting selected row
  const rowClass = useCallback(
    (row: DataGridRowType) => {
      if (selectedRowId && row.id === selectedRowId) {
        return 'bg-[var(--alpha-4)]';
      }
      return '';
    },
    [selectedRowId]
  );

  return (
    <DataGrid<DataGridRowType>
      {...restProps}
      data={dataWithIds}
      columns={columns}
      showSelection={false}
      showPagination={true}
      noPadding={noPadding}
      onCellClick={handleCellClick}
      rowClass={rowClass}
      rightPanel={rightPanel}
    />
  );
}
