import React, { useMemo } from 'react';
import {
  DataGrid,
  DefaultCellRenderers,
  type DataGridColumn,
  type DataGridProps,
} from '@/components/DataGrid';
import { BooleanCellEditor } from '@/features/database/components/BooleanCellEditor';
import { DateCellEditor } from '@/features/database/components/DateCellEditor';
import { JsonCellEditor } from '@/features/database/components/JsonCellEditor';
import { ColumnSchema, ColumnType, TableSchema } from '@insforge/shared-schemas';

// Custom cell editors for database fields
function TextCellEditor({ row, column, onRowChange, onClose, onCellEdit }: any) {
  const [value, setValue] = React.useState(String(row[column.key] || ''));

  const handleSave = React.useCallback(async () => {
    const oldValue = row[column.key];
    const newValue = value;

    if (onCellEdit && oldValue !== newValue) {
      try {
        await onCellEdit(row.id, column.key, newValue);
      } catch (error) {
        // Edit failed silently
      }
    }

    const updatedRow = { ...row, [column.key]: newValue };
    onRowChange(updatedRow);
    onClose();
  }, [row, column.key, value, onRowChange, onClose, onCellEdit]);

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
      onBlur={handleSave}
      className="w-full border-none outline-none bg-white focus:border-0! focus:ring-0! focus:ring-offset-0! focus:outline-none!"
      autoFocus
    />
  );
}

function CustomBooleanCellEditor({ row, column, onRowChange, onClose, onCellEdit }: any) {
  const handleValueChange = React.useCallback(
    async (newValue: string) => {
      let value: boolean | null;
      switch (newValue) {
        case 'true':
          value = true;
          break;
        case 'false':
          value = false;
          break;
        case 'null':
          value = null;
          break;
        default:
          value = null;
      }

      if (onCellEdit && row[column.key] !== value) {
        try {
          await onCellEdit(row.id, column.key, value);
        } catch (error) {
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
        value={row[column.key]}
        nullable={true}
        onValueChange={handleValueChange}
        onCancel={onClose}
      />
    </div>
  );
}

function CustomDateCellEditor({ row, column, onRowChange, onClose, onCellEdit }: any) {
  const handleValueChange = React.useCallback(
    async (newValue: string) => {
      if (onCellEdit && row[column.key] !== newValue) {
        try {
          await onCellEdit(row.id, column.key, newValue);
        } catch (error) {
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
        value={row[column.key]}
        nullable={true}
        onValueChange={handleValueChange}
        onCancel={onClose}
      />
    </div>
  );
}

function CustomJsonCellEditor({ row, column, onRowChange, onClose, onCellEdit }: any) {
  const handleValueChange = React.useCallback(
    async (newValue: string) => {
      if (onCellEdit && row[column.key] !== newValue) {
        try {
          await onCellEdit(row.id, column.key, newValue);
        } catch (error) {
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
      <JsonCellEditor
        value={row[column.key]}
        nullable={true}
        onValueChange={handleValueChange}
        onCancel={onClose}
      />
    </div>
  );
}

// Convert database schema to DataGrid columns
export function convertSchemaToColumns(
  schema?: TableSchema,
  onCellEdit?: (rowId: string, columnKey: string, newValue: any) => Promise<void>
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
    const isSortable = !['jsonb', 'json'].includes(col.type?.toLowerCase());

    const column: DataGridColumn = {
      key: col.columnName,
      name: col.columnName,
      type: col.type,
      width: 'minmax(200px, 1fr)',
      resizable: true,
      sortable: isSortable,
      editable: isEditable,
      isPrimaryKey: col.isPrimaryKey,
    };

    // Set custom renderers based on column type
    if (col.columnName === 'id') {
      column.renderCell = DefaultCellRenderers.id;
      column.editable = false;
    } else if (col.type === ColumnType.BOOLEAN) {
      column.renderCell = DefaultCellRenderers.boolean;
      column.renderEditCell = (props: any) => (
        <CustomBooleanCellEditor {...props} onCellEdit={onCellEdit} />
      );
    } else if (col.type === ColumnType.DATETIME) {
      column.renderCell = DefaultCellRenderers.date;
      column.renderEditCell = (props: any) => (
        <CustomDateCellEditor {...props} onCellEdit={onCellEdit} />
      );
    } else if (col.type === ColumnType.JSON) {
      column.renderCell = DefaultCellRenderers.json;
      column.renderEditCell = (props: any) => (
        <CustomJsonCellEditor {...props} onCellEdit={onCellEdit} />
      );
    } else {
      column.renderCell = DefaultCellRenderers.text;
      column.renderEditCell = (props: any) => <TextCellEditor {...props} onCellEdit={onCellEdit} />;
    }

    return column;
  });
}

// Database-specific DataGrid props
export interface DatabaseDataGridProps extends Omit<DataGridProps, 'columns'> {
  schema?: TableSchema;
}

// Specialized DataGrid for database tables
export function DatabaseDataGrid({
  schema,
  onCellEdit,
  emptyStateTitle = 'No data available',
  emptyStateDescription,
  ...props
}: DatabaseDataGridProps) {
  const columns = useMemo(() => {
    return convertSchemaToColumns(schema, onCellEdit);
  }, [schema, onCellEdit]);

  const defaultEmptyDescription = props.searchQuery
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
