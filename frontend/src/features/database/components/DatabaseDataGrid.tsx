import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DataGrid,
  createDefaultCellRenderer,
  type DataGridColumn,
  type DataGridProps,
  type DataGridRowType,
  type RenderCellProps,
  type RenderEditCellProps,
  BooleanCellEditor,
  DateCellEditor,
  JsonCellEditor,
  TextCellEditor,
} from '@/components/datagrid';
import { ColumnSchema, ColumnType, TableSchema } from '@insforge/shared-schemas';
import { ForeignKeyCell } from './ForeignKeyCell';

// Create a type adapter for database records
// Database records are dynamic and must have string id for DataGrid compatibility
type DatabaseDataGridRow = DataGridRowType;

type PersistedColumnWidths = Record<string, number>;

interface DatabaseGridPreferences {
  columnWidthsByTable?: Record<string, PersistedColumnWidths>;
}

const DATABASE_GRID_PREFERENCES_STORAGE_KEY = 'database-grid-preferences';
const DEFAULT_COLUMN_WIDTH = 'minmax(200px, 1fr)';

function loadPersistedColumnWidths(
  tableName?: string,
  schema?: TableSchema
): PersistedColumnWidths {
  if (typeof window === 'undefined' || !tableName) {
    return {};
  }

  try {
    const stored = localStorage.getItem(DATABASE_GRID_PREFERENCES_STORAGE_KEY);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored) as DatabaseGridPreferences;
    const savedWidths = parsed.columnWidthsByTable?.[tableName];
    if (!savedWidths || typeof savedWidths !== 'object') {
      return {};
    }

    const validColumnNames = new Set(schema?.columns.map((column) => column.columnName) ?? []);

    return Object.fromEntries(
      Object.entries(savedWidths).filter(
        ([columnName, width]) =>
          validColumnNames.has(columnName) &&
          typeof width === 'number' &&
          Number.isFinite(width) &&
          width > 0
      )
    );
  } catch (error) {
    console.error('Failed to load database grid widths from localStorage:', error);
    return {};
  }
}

function persistColumnWidths(tableName: string, columnWidths: PersistedColumnWidths) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const stored = localStorage.getItem(DATABASE_GRID_PREFERENCES_STORAGE_KEY);
    const parsed = stored ? (JSON.parse(stored) as DatabaseGridPreferences) : {};
    const columnWidthsByTable = {
      ...(parsed.columnWidthsByTable ?? {}),
      [tableName]: columnWidths,
    };

    localStorage.setItem(
      DATABASE_GRID_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...parsed,
        columnWidthsByTable,
      })
    );
  } catch (error) {
    console.error('Failed to save database grid widths to localStorage:', error);
  }
}

// Custom cell editor wrapper components that handle database-specific logic
function DatabaseTextCellEditor({
  row,
  column,
  onRowChange,
  onClose,
  onCellEdit,
  primaryKeyColumn,
}: RenderEditCellProps<DatabaseDataGridRow> & {
  onCellEdit?: (rowId: string, columnKey: string, newValue: string) => Promise<void>;
  primaryKeyColumn: string;
}) {
  const handleValueChange = React.useCallback(
    (newValue: string) => {
      const oldValue = row[column.key];

      if (onCellEdit && String(oldValue ?? '') !== String(newValue)) {
        void onCellEdit(String(row[primaryKeyColumn] || ''), column.key, newValue);
      }

      const updatedRow = { ...row, [column.key]: newValue };
      onRowChange(updatedRow);
      onClose();
    },
    [row, column.key, onCellEdit, onRowChange, onClose, primaryKeyColumn]
  );

  return (
    <TextCellEditor
      value={String(row[column.key] || '')}
      nullable={false}
      onValueChange={handleValueChange}
      onCancel={onClose}
    />
  );
}

function DatabaseBooleanCellEditor({
  row,
  column,
  onRowChange,
  onClose,
  onCellEdit,
  columnSchema,
  primaryKeyColumn,
}: RenderEditCellProps<DatabaseDataGridRow> & {
  onCellEdit?: (rowId: string, columnKey: string, newValue: string) => Promise<void>;
  columnSchema: ColumnSchema;
  primaryKeyColumn: string;
}) {
  const handleValueChange = React.useCallback(
    (newValue: string) => {
      const value: boolean | null = newValue === 'null' ? null : newValue === 'true';

      if (onCellEdit && row[column.key] !== value) {
        void onCellEdit(String(row[primaryKeyColumn] || ''), column.key, newValue);
      }

      const updatedRow = { ...row, [column.key]: value };
      onRowChange(updatedRow);
      onClose();
    },
    [row, column.key, onRowChange, onClose, onCellEdit, primaryKeyColumn]
  );

  return (
    <BooleanCellEditor
      value={row[column.key] as boolean | null}
      nullable={columnSchema.isNullable || false}
      onValueChange={handleValueChange}
      onCancel={onClose}
      className="h-full rounded-none border-0 bg-transparent p-0 shadow-none"
    />
  );
}

function DatabaseDateCellEditor({
  row,
  column,
  onRowChange,
  onClose,
  onCellEdit,
  columnSchema,
  primaryKeyColumn,
}: RenderEditCellProps<DatabaseDataGridRow> & {
  onCellEdit?: (rowId: string, columnKey: string, newValue: string) => Promise<void>;
  columnSchema: ColumnSchema;
  primaryKeyColumn: string;
}) {
  const handleValueChange = React.useCallback(
    (newValue: string | null) => {
      if (
        onCellEdit &&
        new Date(row[column.key] as string).getTime() !== new Date(newValue ?? '').getTime()
      ) {
        void onCellEdit(String(row[primaryKeyColumn] || ''), column.key, newValue ?? '');
      }

      const updatedRow = { ...row, [column.key]: newValue };
      onRowChange(updatedRow);
      onClose();
    },
    [onCellEdit, row, column.key, onRowChange, onClose, primaryKeyColumn]
  );

  return (
    <DateCellEditor
      value={row[column.key] as string | null}
      nullable={columnSchema.isNullable || false}
      type={columnSchema.type as ColumnType.DATE | ColumnType.DATETIME}
      onValueChange={handleValueChange}
      onCancel={onClose}
    />
  );
}

function DatabaseJsonCellEditor({
  row,
  column,
  onRowChange,
  onClose,
  onCellEdit,
  columnSchema,
  primaryKeyColumn,
}: RenderEditCellProps<DatabaseDataGridRow> & {
  onCellEdit?: (rowId: string, columnKey: string, newValue: string) => Promise<void>;
  columnSchema: ColumnSchema;
  primaryKeyColumn: string;
}) {
  const handleValueChange = React.useCallback(
    (newValue: string) => {
      if (onCellEdit && row[column.key] !== newValue) {
        void onCellEdit(String(row[primaryKeyColumn] || ''), column.key, newValue);
      }

      const updatedRow = { ...row, [column.key]: newValue };
      onRowChange(updatedRow);
      onClose();
    },
    [column.key, onCellEdit, row, onRowChange, onClose, primaryKeyColumn]
  );

  return (
    <JsonCellEditor
      value={row[column.key] as string | null}
      nullable={columnSchema.isNullable || false}
      onValueChange={handleValueChange}
      onCancel={onClose}
    />
  );
}

// Convert database schema to DataGrid columns
export function convertSchemaToColumns(
  schema?: TableSchema,
  onCellEdit?: (rowId: string, columnKey: string, newValue: string) => Promise<void>,
  onJumpToTable?: (tableName: string) => void,
  columnWidths: PersistedColumnWidths = {}
): DataGridColumn<DatabaseDataGridRow>[] {
  if (!schema?.columns) {
    return [];
  }

  const primaryKeyColumn = schema.columns.find((col) => col.isPrimaryKey)?.columnName || '';

  // Create typed cell renderers
  const cellRenderers = createDefaultCellRenderer<DatabaseDataGridRow>();

  return schema.columns.map((col: ColumnSchema) => {
    const isEditable =
      !col.isPrimaryKey &&
      [
        ColumnType.UUID,
        ColumnType.STRING,
        ColumnType.INTEGER,
        ColumnType.FLOAT,
        ColumnType.BOOLEAN,
        ColumnType.DATE,
        ColumnType.DATETIME,
        ColumnType.JSON,
      ].includes(col.type as ColumnType);
    const isSortable = col.type?.toLowerCase() !== ColumnType.JSON;

    const column: DataGridColumn<DatabaseDataGridRow> = {
      key: col.columnName,
      name: col.columnName,
      type: col.type as ColumnType,
      width: columnWidths[col.columnName] ?? DEFAULT_COLUMN_WIDTH,
      resizable: true,
      sortable: isSortable,
      editable: isEditable,
      isPrimaryKey: col.isPrimaryKey,
      isNullable: col.isNullable,
    };

    // Set custom renderers - check for foreign key first (highest priority)
    if (col.foreignKey) {
      // Foreign key column - show reference popover, disable editing
      column.renderCell = (props: RenderCellProps<DatabaseDataGridRow>) => (
        <ForeignKeyCell
          value={String(props.row[col.columnName] || '')}
          foreignKey={{
            table: col.foreignKey?.referenceTable || '',
            column: col.foreignKey?.referenceColumn || '',
          }}
          onJumpToTable={onJumpToTable}
        />
      );
    } else if (col.columnName === primaryKeyColumn) {
      column.renderCell = cellRenderers.id;
    } else if (col.type === ColumnType.BOOLEAN) {
      column.renderCell = cellRenderers.boolean;
      column.renderEditCell = (props: RenderEditCellProps<DatabaseDataGridRow>) => (
        <DatabaseBooleanCellEditor
          {...props}
          columnSchema={col}
          onCellEdit={onCellEdit}
          primaryKeyColumn={primaryKeyColumn}
        />
      );
    } else if (col.type === ColumnType.DATE) {
      column.renderCell = cellRenderers.date;
      column.renderEditCell = (props: RenderEditCellProps<DatabaseDataGridRow>) => (
        <DatabaseDateCellEditor
          {...props}
          columnSchema={col}
          onCellEdit={onCellEdit}
          primaryKeyColumn={primaryKeyColumn}
        />
      );
    } else if (col.type === ColumnType.DATETIME) {
      column.renderCell = cellRenderers.datetime;
      column.renderEditCell = (props: RenderEditCellProps<DatabaseDataGridRow>) => (
        <DatabaseDateCellEditor
          {...props}
          columnSchema={col}
          onCellEdit={onCellEdit}
          primaryKeyColumn={primaryKeyColumn}
        />
      );
    } else if (col.type === ColumnType.JSON) {
      column.renderCell = cellRenderers.json;
      column.renderEditCell = (props: RenderEditCellProps<DatabaseDataGridRow>) => (
        <DatabaseJsonCellEditor
          {...props}
          columnSchema={col}
          onCellEdit={onCellEdit}
          primaryKeyColumn={primaryKeyColumn}
        />
      );
    } else {
      column.renderCell = cellRenderers.text;
      column.renderEditCell = (props: RenderEditCellProps<DatabaseDataGridRow>) => (
        <DatabaseTextCellEditor
          {...props}
          onCellEdit={onCellEdit}
          primaryKeyColumn={primaryKeyColumn}
        />
      );
    }

    return column;
  });
}

// Database-specific DataGrid props
export interface DatabaseDataGridProps extends Omit<DataGridProps<DatabaseDataGridRow>, 'columns'> {
  schema?: TableSchema;
  onCellEdit?: (rowId: string, columnKey: string, newValue: string) => Promise<void>;
  onJumpToTable?: (tableName: string) => void;
}

// Specialized DataGrid for database tables
export function DatabaseDataGrid({
  schema,
  onCellEdit,
  onJumpToTable,
  ...props
}: DatabaseDataGridProps) {
  const tableName = schema?.tableName;
  const schemaSignature = useMemo(
    () => schema?.columns.map((column) => column.columnName).join('|') ?? '',
    [schema]
  );
  const [columnWidths, setColumnWidths] = useState<PersistedColumnWidths>(() =>
    loadPersistedColumnWidths(tableName, schema)
  );

  useEffect(() => {
    setColumnWidths(loadPersistedColumnWidths(tableName, schema));
  }, [schema, schemaSignature, tableName]);

  const handleColumnResize = useCallback(
    (columnKey: string, width: number) => {
      if (!tableName || !Number.isFinite(width) || width <= 0) {
        return;
      }

      setColumnWidths((previous) => {
        const next = {
          ...previous,
          [columnKey]: width,
        };

        persistColumnWidths(tableName, next);
        return next;
      });
    },
    [tableName]
  );

  const columns = useMemo(() => {
    return convertSchemaToColumns(schema, onCellEdit, onJumpToTable, columnWidths);
  }, [schema, onCellEdit, onJumpToTable, columnWidths]);

  return (
    <DataGrid<DatabaseDataGridRow>
      {...props}
      columns={columns}
      onColumnResize={handleColumnResize}
      showSelection={true}
      showPagination={true}
    />
  );
}
