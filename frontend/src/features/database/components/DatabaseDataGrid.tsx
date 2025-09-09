import React, { useMemo } from 'react';
import {
  DataGrid,
  DefaultCellRenderers,
  type DataGridProps,
  type RenderCellProps,
  type RenderEditCellProps,
  type DataGridColumn,
  type DataGridRow,
  type UserInputValue,
} from '@/components/datagrid';
import {
  BooleanCellEditor,
  DateCellEditor,
  JsonCellEditor,
} from '@/features/database/components/cellEditors';
import { ColumnSchema, ColumnType, TableSchema } from '@insforge/shared-schemas';
import { ForeignKeyCell } from './ForeignKeyCell';

// Extended props for database cell editors
interface DatabaseCellEditorProps extends RenderEditCellProps<DataGridRow> {
  onCellEdit?: (rowId: string, columnKey: string, newValue: UserInputValue) => Promise<void>;
  columnSchema?: ColumnSchema;
}

// Custom cell editors for database fields
function TextCellEditor({
  row,
  column,
  onRowChange,
  onClose,
  onCellEdit,
}: DatabaseCellEditorProps) {
  const [value, setValue] = React.useState(String(row[column.key] || ''));

  const handleSave = React.useCallback(async () => {
    const oldValue = row[column.key];
    const newValue = value;

    if (onCellEdit && String(oldValue) !== String(newValue)) {
      try {
        await onCellEdit(row.id, column.key, newValue);
      } catch {
        // Edit failed silently
      }
    }

    const updatedRow = { ...row, [column.key]: newValue };
    onRowChange(updatedRow);
    onClose();
  }, [row, column.key, value, onCellEdit, onRowChange, onClose]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [handleSave, onClose]
  );

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => void handleSave()}
      className="w-full border-none outline-none bg-white dark:bg-neutral-800 focus:border-0! focus:ring-0! focus:ring-offset-0! focus:outline-none!"
      autoFocus
    />
  );
}

function CustomBooleanCellEditor({
  row,
  column,
  onRowChange,
  onClose,
  onCellEdit,
  columnSchema,
}: DatabaseCellEditorProps) {
  const handleValueChange = React.useCallback(
    async (newValue: string) => {
      const value: boolean | null = newValue === 'null' ? null : newValue === 'true';

      if (onCellEdit && row[column.key] !== value) {
        try {
          await onCellEdit(row.id, column.key, value);
        } catch {
          // Edit failed silently
        }
      }

      const updatedRow = { ...row, [column.key]: value };
      onRowChange(updatedRow);
      onClose();
    },
    [row, column.key, onRowChange, onClose, onCellEdit]
  );

  return (
    <div className="w-full h-full">
      <BooleanCellEditor
        value={row[column.key] as boolean | null}
        nullable={columnSchema?.isNullable ?? false}
        onValueChange={(value) => void handleValueChange(value)}
        onCancel={onClose}
      />
    </div>
  );
}

function CustomDateCellEditor({
  row,
  column,
  onRowChange,
  onClose,
  onCellEdit,
  columnSchema,
}: DatabaseCellEditorProps) {
  const handleValueChange = React.useCallback(
    async (newValue: string | null) => {
      const currentValue = row[column.key] as string | null;
      if (
        onCellEdit &&
        new Date(currentValue ?? '').getTime() !== new Date(newValue ?? '').getTime()
      ) {
        try {
          await onCellEdit(row.id, column.key, newValue);
        } catch {
          // Edit failed silently
        }
      }

      const updatedRow = { ...row, [column.key]: newValue };
      onRowChange(updatedRow);
      onClose();
    },
    [row, column.key, onRowChange, onClose, onCellEdit]
  );

  return (
    <div className="w-full h-full">
      <DateCellEditor
        value={row[column.key] as string | null}
        nullable={columnSchema?.isNullable ?? false}
        onValueChange={(value) => void handleValueChange(value)}
        onCancel={onClose}
      />
    </div>
  );
}

function CustomJsonCellEditor({
  row,
  column,
  onRowChange,
  onClose,
  onCellEdit,
  columnSchema,
}: DatabaseCellEditorProps) {
  const handleValueChange = React.useCallback(
    async (newValue: string | null) => {
      if (onCellEdit && row[column.key] !== newValue) {
        try {
          await onCellEdit(row.id, column.key, newValue);
        } catch {
          // Edit failed silently
        }
      }

      const updatedRow = { ...row, [column.key]: newValue };
      onRowChange(updatedRow);
      onClose();
    },
    [column.key, onCellEdit, row, onRowChange, onClose]
  );

  return (
    <div className="w-full h-full">
      <JsonCellEditor
        value={row[column.key] as string | null}
        nullable={columnSchema?.isNullable ?? false}
        onValueChange={(value) => void handleValueChange(value)}
        onCancel={onClose}
      />
    </div>
  );
}

// Convert database schema to DataGrid columns
export function convertSchemaToColumns(
  schema?: TableSchema,
  onCellEdit?: (rowId: string, columnKey: string, newValue: UserInputValue) => Promise<void>,
  onJumpToTable?: (tableName: string) => void
): DataGridColumn[] {
  if (!schema?.columns) {
    return [];
  }

  return schema.columns.map((col: ColumnSchema) => {
    const isEditable =
      !col.isPrimaryKey &&
      [
        ColumnType.UUID,
        ColumnType.STRING,
        ColumnType.INTEGER,
        ColumnType.FLOAT,
        ColumnType.BOOLEAN,
        ColumnType.DATETIME,
        ColumnType.JSON,
      ].includes(col.type);
    const isSortable = col.type?.toLowerCase() !== ColumnType.JSON;

    const column: DataGridColumn = {
      key: col.columnName,
      name: col.columnName,
      type: col.type,
      width: 'minmax(200px, 1fr)',
      resizable: true,
      sortable: isSortable,
      editable: isEditable,
      isPrimaryKey: col.isPrimaryKey,
      isNullable: col.isNullable,
    };

    // Set custom renderers - check for foreign key first (highest priority)
    if (col.foreignKey) {
      const fk = col.foreignKey;
      // Foreign key column - show reference popover, disable editing
      column.renderCell = (props: RenderCellProps<DataGridRow>) => {
        return (
          <ForeignKeyCell
            value={props.row[col.columnName]}
            foreignKey={{
              table: fk.referenceTable,
              column: fk.referenceColumn,
            }}
            onJumpToTable={onJumpToTable}
          />
        );
      };
    } else if (col.columnName === 'id') {
      column.renderCell = DefaultCellRenderers.id;
    } else if (col.type === ColumnType.BOOLEAN) {
      column.renderCell = DefaultCellRenderers.boolean;
      column.renderEditCell = (props: RenderEditCellProps<DataGridRow>) => (
        <CustomBooleanCellEditor {...props} onCellEdit={onCellEdit} columnSchema={col} />
      );
    } else if (col.type === ColumnType.DATETIME) {
      column.renderCell = DefaultCellRenderers.date;
      column.renderEditCell = (props: RenderEditCellProps<DataGridRow>) => (
        <CustomDateCellEditor {...props} onCellEdit={onCellEdit} columnSchema={col} />
      );
    } else if (col.type === ColumnType.JSON) {
      column.renderCell = DefaultCellRenderers.json;
      column.renderEditCell = (props: RenderEditCellProps<DataGridRow>) => (
        <CustomJsonCellEditor {...props} onCellEdit={onCellEdit} columnSchema={col} />
      );
    } else {
      column.renderCell = DefaultCellRenderers.text;
      column.renderEditCell = (props: RenderEditCellProps<DataGridRow>) => (
        <TextCellEditor {...props} onCellEdit={onCellEdit} />
      );
    }

    return column;
  });
}

// Database-specific DataGrid props
export interface DatabaseDataGridProps extends Omit<DataGridProps, 'columns'> {
  searchQuery?: string;
  schema?: TableSchema;
  onJumpToTable?: (tableName: string) => void;
  onCellEdit?: (rowId: string, columnKey: string, newValue: UserInputValue) => Promise<void>;
}

// Specialized DataGrid for database tables
export function DatabaseDataGrid({
  searchQuery,
  schema,
  onCellEdit,
  onJumpToTable,
  emptyStateTitle = 'No data available',
  emptyStateDescription,
  ...props
}: DatabaseDataGridProps) {
  const columns = useMemo(() => {
    return convertSchemaToColumns(schema, onCellEdit, onJumpToTable);
  }, [schema, onCellEdit, onJumpToTable]);

  const defaultEmptyDescription = searchQuery
    ? 'No records match your search criteria'
    : 'This table contains no records';

  return (
    <DataGrid
      {...props}
      columns={columns}
      emptyStateTitle={emptyStateTitle}
      emptyStateDescription={emptyStateDescription || defaultEmptyDescription}
      showSelection={true}
      showPagination={true}
    />
  );
}
