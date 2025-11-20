import { useMemo } from 'react';
import {
  DataGrid,
  type DataGridProps,
  type RenderCellProps,
  type DataGridColumn,
  type DataGridRowType,
} from '@/components/datagrid';

// Column definition type for LogsDataGrid
export interface LogsColumnDef {
  key: string;
  name: string;
  width?: string;
  minWidth?: number;
  maxWidth?: number;
  sortable?: boolean;
  renderCell?: (props: RenderCellProps<DataGridRowType>) => React.ReactNode;
}

// Convert logs data to DataGrid columns with custom renderers
export function createLogsColumns(columnDefs: LogsColumnDef[]): DataGridColumn<DataGridRowType>[] {
  return columnDefs.map((def) => {
    const column: DataGridColumn<DataGridRowType> = {
      key: def.key,
      name: def.name,
      width: def.width || '1fr',
      minWidth: def.minWidth,
      maxWidth: def.maxWidth,
      resizable: true,
      sortable: false,
      renderCell:
        def.renderCell ||
        (({ row, column }: RenderCellProps<DataGridRowType>) => {
          const value = row[column.key];
          const displayValue = String(value ?? '');
          return <span className="text-sm font-normal leading-6 truncate">{displayValue}</span>;
        }),
    };

    return column;
  });
}

// Logs-specific DataGrid props - generic to accept any object type
export interface LogsDataGridProps<T = Record<string, unknown>>
  extends Omit<DataGridProps<DataGridRowType>, 'columns' | 'data'> {
  columnDefs: LogsColumnDef[];
  data: T[];
  noPadding?: boolean;
}

// Specialized DataGrid for logs
export function LogsDataGrid<T = Record<string, unknown>>({
  columnDefs,
  data,
  noPadding,
  ...restProps
}: LogsDataGridProps<T>) {
  const columns = useMemo(() => {
    return createLogsColumns(columnDefs);
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

  return (
    <DataGrid<DataGridRowType>
      {...restProps}
      data={dataWithIds}
      columns={columns}
      showSelection={false}
      showPagination={true}
      noPadding={noPadding}
    />
  );
}
