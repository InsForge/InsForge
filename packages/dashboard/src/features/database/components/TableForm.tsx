import { useState, useEffect, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Plus, X, Link, MoveRight } from 'lucide-react';
import { Button, Input } from '@insforge/ui';
import { Alert, AlertDescription } from '../../../components';
import { tableService } from '../services/table.service';
import {
  TableFormColumnSchema,
  TableFormForeignKeySchema,
  tableFormSchema,
  TableFormSchema,
} from '../schema';
import { useToast } from '../../../lib/hooks/useToast';
import { TableFormColumn } from './TableFormColumn';
import { ForeignKeyPopover } from './ForeignKeyPopover';
import { ColumnType, TableSchema, UpdateTableSchemaRequest } from '@insforge/shared-schemas';
import { SYSTEM_FIELDS } from '../helpers';
import { databaseTableQueryKeys } from '../queryKeys';

const newColumn: TableFormColumnSchema = {
  columnName: '',
  type: ColumnType.STRING,
  isNullable: true,
  isUnique: false,
  defaultValue: '',
  isSystemColumn: false,
  isNewColumn: true,
};

interface TableFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (newTable?: string) => void;
  mode?: 'create' | 'edit';
  editTable?: TableSchema;
  setFormIsDirty: (dirty: boolean) => void;
}

export function TableForm({
  open,
  onOpenChange,
  onSuccess,
  mode = 'create',
  editTable,
  setFormIsDirty,
}: TableFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [showForeignKeyDialog, setShowForeignKeyDialog] = useState(false);
  const [editingForeignKey, setEditingForeignKey] = useState<string>();
  const [foreignKeys, setForeignKeys] = useState<TableFormForeignKeySchema[]>([]);
  const [foreignKeysDirty, setForeignKeysDirty] = useState(false);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const form = useForm({
    resolver: zodResolver(tableFormSchema),
    defaultValues: {
      tableName: '',
      columns:
        mode === 'create'
          ? [
              {
                columnName: 'id',
                type: ColumnType.UUID,
                defaultValue: 'gen_random_uuid()',
                isPrimaryKey: true,
                isNullable: false,
                isUnique: true,
                isSystemColumn: true,
                isNewColumn: false,
              },
              {
                columnName: 'created_at',
                type: ColumnType.DATETIME,
                defaultValue: 'CURRENT_TIMESTAMP',
                isNullable: true,
                isUnique: false,
                isSystemColumn: true,
                isNewColumn: false,
              },
              {
                columnName: 'updated_at',
                type: ColumnType.DATETIME,
                defaultValue: 'CURRENT_TIMESTAMP',
                isNullable: true,
                isUnique: false,
                isSystemColumn: true,
                isNewColumn: false,
              },
              {
                ...newColumn,
              },
            ]
          : [{ ...newColumn }],
    },
  });

  // Reset form when switching between modes or when editTable changes
  useEffect(() => {
    // Clear error when effect runs
    setError(null);

    if (open && mode === 'edit' && editTable) {
      form.reset({
        tableName: editTable.tableName,
        columns: editTable.columns.map((col) => ({
          columnName: col.columnName,
          type: col.type,
          isPrimaryKey: col.isPrimaryKey,
          isNullable: col.isNullable,
          isUnique: col.isUnique || false,
          defaultValue: col.defaultValue || '',
          originalName: col.columnName, // Track original name for rename detection
          isSystemColumn: SYSTEM_FIELDS.includes(col.columnName),
          isNewColumn: false,
        })),
      });

      // Set foreign keys from editTable
      const existingForeignKeys = editTable.columns
        .filter((col) => !SYSTEM_FIELDS.includes(col.columnName) && col.foreignKey)
        .map((col) => ({
          columnName: col.columnName,
          referenceTable: col.foreignKey?.referenceTable ?? '',
          referenceColumn: col.foreignKey?.referenceColumn ?? '',
          onDelete: col.foreignKey?.onDelete || 'NO ACTION',
          onUpdate: col.foreignKey?.onUpdate || 'NO ACTION',
        }));
      setForeignKeys(existingForeignKeys);
    } else {
      form.reset({
        tableName: '',
        columns: [
          {
            columnName: 'id',
            type: ColumnType.UUID,
            defaultValue: 'gen_random_uuid()',
            isPrimaryKey: true,
            isNullable: false,
            isUnique: true,
            isSystemColumn: true,
            isNewColumn: false,
          },
          {
            columnName: 'created_at',
            type: ColumnType.DATETIME,
            defaultValue: 'CURRENT_TIMESTAMP',
            isNullable: true,
            isUnique: false,
            isSystemColumn: true,
            isNewColumn: false,
          },
          {
            columnName: 'updated_at',
            type: ColumnType.DATETIME,
            defaultValue: 'CURRENT_TIMESTAMP',
            isNullable: true,
            isUnique: false,
            isSystemColumn: true,
            isNewColumn: false,
          },
          { ...newColumn },
        ],
      });
      setForeignKeys([]);
    }
  }, [mode, editTable, form, open]);

  useEffect(() => {
    setFormIsDirty(form.formState.isDirty);
  }, [form.formState.isDirty, setFormIsDirty]);

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'columns',
  });

  const sortedFields = useMemo(() => {
    return [...fields].sort((a, b) => {
      // System fields come first
      if (a.isSystemColumn && !b.isSystemColumn) {
        return -1;
      }
      if (!a.isSystemColumn && b.isSystemColumn) {
        return 1;
      }

      // Within system fields, maintain the order: id, createdAt, updated_at
      if (a.isSystemColumn && b.isSystemColumn) {
        return SYSTEM_FIELDS.indexOf(a.columnName) - SYSTEM_FIELDS.indexOf(b.columnName);
      }

      // Keep original order for non-system fields
      return 0;
    });
  }, [fields]);

  const createTableMutation = useMutation({
    mutationFn: (data: TableFormSchema) => {
      const columns = data.columns.map((col) => {
        // Find foreign key for this field if it exists
        const foreignKey = foreignKeys.find((fk) => fk.columnName === col.columnName);

        return {
          columnName: col.columnName,
          type: col.type,
          isNullable: col.isNullable,
          isUnique: col.isUnique,
          defaultValue: col.defaultValue,
          // Embed foreign key information directly in the column
          ...(foreignKey && {
            foreignKey: {
              referenceTable: foreignKey.referenceTable,
              referenceColumn: foreignKey.referenceColumn,
              onDelete: foreignKey.onDelete,
              onUpdate: foreignKey.onUpdate,
            },
          }),
        };
      });

      return tableService.createTable(data.tableName, columns);
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['database-metadata'] });
      void queryClient.invalidateQueries({ queryKey: databaseTableQueryKeys.list });
      void queryClient.invalidateQueries({ queryKey: ['metadata'] });

      showToast('Table created successfully!', 'success');

      form.reset();
      setError(null);
      setForeignKeys([]);
      setForeignKeysDirty(false);
      onSuccess?.(data.tableName);
    },
    onError: (err) => {
      const errorMessage = err.message || 'Failed to create table';
      setError(errorMessage);
      showToast(errorMessage, 'error');
    },
  });

  const updateTableMutation = useMutation({
    mutationFn: (data: TableFormSchema) => {
      if (!editTable) {
        return Promise.resolve();
      }

      // Compare fields to determine what operations to perform
      const addColumns: UpdateTableSchemaRequest['addColumns'] = [];
      const dropColumns: UpdateTableSchemaRequest['dropColumns'] = [];
      const updateColumns: UpdateTableSchemaRequest['updateColumns'] = [];
      const addForeignKeys: UpdateTableSchemaRequest['addForeignKeys'] = [];
      const dropForeignKeys: UpdateTableSchemaRequest['dropForeignKeys'] = [];

      // Filter out system columns from existing fields for comparison
      const existingUserColumns = editTable.columns.filter(
        (col) => !SYSTEM_FIELDS.includes(col.columnName)
      );

      // Track which original columns we've seen
      const processedOriginalColumns = new Set<string>();

      // Process each field
      data.columns.forEach((col) => {
        if (col.originalName) {
          // This field existed before
          processedOriginalColumns.add(col.originalName);
          const newDefaultValue = col.defaultValue || undefined;
          const originalDefaultValue = editTable.columns.find(
            (_col) => _col.columnName === col.originalName
          )?.defaultValue;

          // Check if it was renamed
          if (col.originalName !== col.columnName) {
            updateColumns.push({
              columnName: col.originalName,
              defaultValue:
                newDefaultValue !== originalDefaultValue ? (newDefaultValue ?? '') : undefined,
              newColumnName: col.columnName,
            });
          } else if (newDefaultValue !== originalDefaultValue) {
            updateColumns.push({
              columnName: col.columnName,
              defaultValue: newDefaultValue ?? '',
            });
          }
        } else {
          // This is a new field (added via Add Field button)
          const { ...fieldData } = col;
          addColumns.push({
            ...fieldData,
            defaultValue: fieldData.defaultValue || undefined,
          });
        }
      });

      // Find dropped columns
      existingUserColumns.forEach((col) => {
        if (!processedOriginalColumns.has(col.columnName)) {
          dropColumns.push(col.columnName);
        }
      });

      // Handle foreign keys
      // Get existing foreign keys from editTable
      const existingForeignKeys = existingUserColumns
        .filter((col) => col.foreignKey)
        .map((col) => ({
          columnName: col.columnName,
          ...col.foreignKey,
        }));

      // Compare with new foreign keys
      foreignKeys.forEach((fk) => {
        const existingFK = existingForeignKeys.find((efk) => efk.columnName === fk.columnName);

        if (!existingFK) {
          addForeignKeys.push({
            columnName: fk.columnName,
            foreignKey: {
              referenceTable: fk.referenceTable,
              referenceColumn: fk.referenceColumn,
              onDelete: fk.onDelete,
              onUpdate: fk.onUpdate,
            },
          });
        }
      });

      // Check for dropped foreign keys
      existingForeignKeys.forEach((efk) => {
        const stillExists = foreignKeys.find((fk) => fk.columnName === efk.columnName);
        if (!stillExists) {
          // This foreign key was removed
          dropForeignKeys.push(efk.columnName);
        }
      });

      const operations: UpdateTableSchemaRequest = {
        addColumns,
        dropColumns,
        updateColumns,
        addForeignKeys,
        dropForeignKeys,
      };

      if (data.tableName !== editTable.tableName) {
        operations.renameTable = { newTableName: data.tableName };
      }

      return tableService.updateTableSchema(editTable.tableName, operations);
    },
    onSuccess: (_, data) => {
      void queryClient.invalidateQueries({ queryKey: ['database-metadata'] });
      void queryClient.invalidateQueries({ queryKey: databaseTableQueryKeys.list });
      void queryClient.invalidateQueries({ queryKey: ['metadata'] });
      if (editTable?.tableName) {
        void queryClient.invalidateQueries({
          queryKey: databaseTableQueryKeys.schema(editTable.tableName),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: databaseTableQueryKeys.schema(data.tableName),
      });

      // Invalidate all table data queries for this table (with all parameter combinations)
      void queryClient.invalidateQueries({ queryKey: ['records', editTable?.tableName] });
      void queryClient.invalidateQueries({ queryKey: ['records', data.tableName] });

      showToast(`Table "${data.tableName}" updated successfully!`, 'success');

      form.reset();
      setError(null);
      setForeignKeys([]);
      setForeignKeysDirty(false);
      onSuccess?.(data.tableName);
    },
    onError: (err) => {
      const errorMessage = err.message || 'Failed to update table';
      setError(errorMessage);
      showToast(errorMessage, 'error');
    },
  });

  const handleSubmit = form.handleSubmit((data) => {
    const userColumns = data.columns.filter((col) => !col.isSystemColumn);
    if (!userColumns.length) {
      const msg =
        mode === 'create'
          ? 'Please add at least one user-defined column to create a table.'
          : 'Please ensure the table has at least one user-defined column.';
      setError(msg);
      showToast(msg, 'error');
      return;
    }
    if (mode === 'edit') {
      updateTableMutation.mutate(data);
    } else {
      createTableMutation.mutate(data);
    }
  });

  const addField = () => {
    append({ ...newColumn });
  };

  const handleAddForeignKey = (fk: TableFormForeignKeySchema) => {
    if (editingForeignKey) {
      // Update existing foreign key
      setForeignKeys(
        foreignKeys.map((existingFk) =>
          existingFk.columnName === editingForeignKey ? { ...fk } : existingFk
        )
      );
      setEditingForeignKey(undefined);
      setForeignKeysDirty(true);
    } else {
      // Add new foreign key
      setForeignKeys([
        ...foreignKeys,
        {
          ...fk,
        },
      ]);
    }
    setForeignKeysDirty(true);
  };

  const handleRemoveForeignKey = (columnName?: string) => {
    setForeignKeys(foreignKeys.filter((fk) => fk.columnName !== columnName));
    setForeignKeysDirty(true);
  };

  if (!open) {
    return null;
  }

  return (
    <div className="flex h-full flex-col bg-semantic-1 text-foreground">
      <div className="px-4 pb-6 pt-10 sm:px-6 lg:px-10">
        <div className="mx-auto w-full max-w-[1024px]">
          <h1 className="text-2xl leading-8 font-medium">
            {mode === 'edit' ? 'Edit Table' : 'Create New Table'}
          </h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 pb-6 sm:px-6 lg:px-10">
        <form
          onSubmit={() => void handleSubmit()}
          className="mx-auto flex w-full max-w-[1024px] flex-col gap-6"
        >
          <div className="flex w-full max-w-[400px] flex-col gap-1.5">
            <label className="text-sm leading-5 text-foreground">Table Name</label>
            <Input
              {...form.register('tableName')}
              placeholder="e.g., products, orders, customers"
              className="bg-[var(--alpha-4)] border-[var(--alpha-12)]"
            />
            {form.formState.errors.tableName && (
              <p className="text-sm text-destructive">{form.formState.errors.tableName.message}</p>
            )}
          </div>

          <div className="overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
            <div className="px-4 py-3">
              <h2 className="text-base leading-7 font-medium">Columns</h2>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                <div className="flex h-8 items-center border-y border-[var(--alpha-8)] pl-1.5 pr-0 text-[13px] leading-[18px] text-muted-foreground">
                  <div className="flex flex-1 items-center px-2.5">Name</div>
                  <div className="flex flex-1 items-center px-2.5">Type</div>
                  <div className="flex flex-1 items-center px-2.5">Default Value</div>
                  <div className="flex w-[100px] items-center justify-center px-2.5">Nullable</div>
                  <div className="flex w-[100px] items-center justify-center px-2.5">Unique</div>
                  <div className="w-[52px]" />
                </div>

                {sortedFields.map((field, index) => {
                  const originalIndex = fields.findIndex((f) => f.id === field.id);
                  return (
                    <TableFormColumn
                      key={field.id}
                      column={field}
                      index={originalIndex}
                      control={form.control}
                      onRemove={() => remove(originalIndex)}
                      isSystemColumn={field.isSystemColumn}
                      isNewColumn={field.isNewColumn}
                      isLast={index === sortedFields.length - 1}
                    />
                  );
                })}
              </div>
            </div>

            <div className="flex justify-center border-t border-[var(--alpha-8)] px-4 py-3">
              <Button
                type="button"
                onClick={addField}
                variant="secondary"
                className="h-8 rounded border-[var(--alpha-8)] bg-card px-2.5 text-sm font-medium hover:before:bg-[var(--alpha-4)]"
              >
                <Plus className="size-5" />
                Add Column
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
            <div className="flex flex-col gap-1 px-4 py-3">
              <h2 className="text-base leading-7 font-medium">Foreign Keys</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Create a relationship between this table and another table
              </p>
            </div>

            {foreignKeys.length > 0 && (
              <div className="overflow-x-auto">
                <div className="min-w-[760px]">
                  <div className="grid h-8 grid-cols-[minmax(260px,1fr)_190px_190px_52px] items-center border-y border-[var(--alpha-8)] px-1.5 text-[13px] leading-[18px] text-muted-foreground">
                    <div className="px-2.5">Relationship</div>
                    <div className="px-2.5">On Update</div>
                    <div className="px-2.5">On Delete</div>
                    <div />
                  </div>

                  {foreignKeys.map((fk, index) => (
                    <div
                      key={fk.columnName}
                      className={`group grid h-12 grid-cols-[minmax(260px,1fr)_190px_190px_52px] items-center px-1.5 hover:bg-[var(--alpha-4)] ${
                        index === foreignKeys.length - 1 ? '' : 'border-b border-[var(--alpha-8)]'
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden px-2.5 text-[13px] leading-[18px]">
                        <Link className="size-5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{fk.columnName}</span>
                        <MoveRight className="size-5 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {fk.referenceTable}.{fk.referenceColumn}
                        </span>
                      </div>
                      <div className="truncate px-2.5 text-[13px] leading-[18px]">
                        {fk.onUpdate}
                      </div>
                      <div className="truncate px-2.5 text-[13px] leading-[18px]">
                        {fk.onDelete}
                      </div>
                      <div className="flex items-center justify-end px-2.5">
                        <button
                          type="button"
                          onClick={() => handleRemoveForeignKey(fk.columnName)}
                          className="flex size-8 items-center justify-center rounded text-muted-foreground opacity-0 transition-[opacity,colors] group-hover:opacity-100 hover:bg-[var(--alpha-8)] hover:text-foreground focus-visible:opacity-100"
                          aria-label="Remove"
                        >
                          <X className="size-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-center border-t border-[var(--alpha-8)] px-4 py-3">
              <Button
                type="button"
                variant="secondary"
                className="h-8 rounded border-[var(--alpha-8)] bg-card px-2.5 text-sm font-medium hover:before:bg-[var(--alpha-4)]"
                onClick={() => setShowForeignKeyDialog(true)}
              >
                <Link className="size-5" />
                Add Foreign Keys
              </Button>
            </div>

            <ForeignKeyPopover
              form={form}
              mode={mode}
              editTableName={editTable?.tableName}
              open={showForeignKeyDialog}
              onOpenChange={(open) => {
                setShowForeignKeyDialog(open);
                if (!open) {
                  setEditingForeignKey(undefined);
                }
              }}
              onAddForeignKey={handleAddForeignKey}
              initialValue={
                editingForeignKey
                  ? foreignKeys.find((fk) => fk.columnName === editingForeignKey)
                  : undefined
              }
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </form>
      </div>

      <div className="border-t border-[var(--alpha-8)] px-4 py-3 sm:px-6 lg:px-10">
        <div className="mx-auto flex w-full max-w-[1024px] justify-end gap-2.5">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded border-[var(--alpha-8)] bg-card px-3 text-sm font-medium hover:before:bg-[var(--alpha-4)]"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={
              !form.formState.isValid ||
              createTableMutation.isPending ||
              updateTableMutation.isPending ||
              (!form.formState.isDirty && !foreignKeysDirty)
            }
            className="h-9 rounded bg-primary px-3 text-sm font-medium text-[rgb(var(--inverse))] hover:before:bg-[var(--alpha-inverse-8)] disabled:opacity-40"
          >
            {mode === 'edit' ? 'Update Table' : 'Create Table'}
          </Button>
        </div>
      </div>
    </div>
  );
}
