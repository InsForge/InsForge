import { useState, useEffect, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Plus, X, Link, MoveRight } from 'lucide-react';
import { Alert, AlertDescription, Button, Input } from '@/components';
import { tableService } from '@/features/database/services/table.service';
import {
  TableFormColumnSchema,
  TableFormForeignKeySchema,
  tableFormSchema,
  TableFormSchema,
} from '@/features/database/schema';
import { useToast } from '@/lib/hooks/useToast';
import { TableFormColumn } from './TableFormColumn';
import { ForeignKeyPopover } from './ForeignKeyPopover';
import { ColumnType, TableSchema, UpdateTableSchemaRequest } from '@insforge/shared-schemas';
import { SYSTEM_FIELDS } from '../helpers';

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
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
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
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      void queryClient.invalidateQueries({ queryKey: ['metadata'] });

      // Invalidate all table data queries for this table (with all parameter combinations)
      void queryClient.invalidateQueries({ queryKey: ['table', editTable?.tableName] });

      showToast(`Table "${data.tableName}" updated successfully!`, 'success');

      form.reset();
      setError(null);
      setForeignKeys([]);
      onSuccess?.();
    },
    onError: (err) => {
      // Invalidate queries to ensure we have fresh data after failed request
      void queryClient.invalidateQueries({ queryKey: ['table', editTable?.tableName] });

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
    <div className="flex flex-col h-full">
      {/* Content area with slate background */}
      <div className="flex-1 bg-slate-100 dark:bg-neutral-900 flex flex-col items-center overflow-auto">
        <div className="flex flex-col gap-6 w-full max-w-[1080px] px-6 py-6">
          {/* Title Bar */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-black dark:text-neutral-50">
              {mode === 'edit' ? 'Edit Table' : 'Create New Table'}
            </h1>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex items-center justify-center w-12 h-12 bg-white dark:bg-neutral-600 rounded-full border border-zinc-200 shadow-sm hover:bg-gray-50 transition-colors dark:border-transparent dark:hover:bg-neutral-700"
            >
              <X className="w-5 h-5 text-zinc-500 dark:text-zinc-300" />
            </button>
          </div>

          <form onSubmit={() => void handleSubmit()} className="flex flex-col gap-6">
            {/* Table Name */}
            <div className="bg-white rounded-xl border border-zinc-200 p-6 dark:bg-neutral-800 dark:border-transparent">
              <div className="flex flex-row gap-10 items-center">
                <label className="whitespace-nowrap text-sm font-normal text-zinc-950 dark:text-neutral-50">
                  Table Name
                </label>
                <Input
                  {...form.register('tableName')}
                  placeholder="e.g., products, orders, customers"
                  className="h-10 rounded-md border-zinc-200 shadow-sm placeholder:text-zinc-500 dark:text-white dark:bg-neutral-900 dark:border-neutral-700 dark:placeholder:text-neutral-400"
                />
                {form.formState.errors.tableName && (
                  <p className="text-sm text-destructive dark:text-red-400">
                    {form.formState.errors.tableName.message}
                  </p>
                )}
              </div>
            </div>

            {/* Columns Section */}
            <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden dark:bg-neutral-800 dark:border-transparent pb-3">
              {/* Columns Header */}
              <div className="p-6 bg-white dark:bg-neutral-800">
                <h2 className="text-base font-medium text-black dark:text-neutral-50">Columns</h2>
              </div>

              {/* Columns Table */}
              <div className="px-3 overflow-x-auto">
                {/* Table Headers */}
                <div className="flex items-center gap-6 px-4 py-2 w-min xl:w-full bg-slate-50 rounded-t text-sm font-medium text-zinc-950 dark:bg-neutral-700 dark:text-white">
                  <div className="flex-1 min-w-[175px]">Name</div>
                  <div className="flex-1 min-w-[175px]">Type</div>
                  <div className="flex-1 min-w-[175px]">Default Value</div>
                  <div className="w-18 2xl:w-25 text-center flex-shrink-0">Nullable</div>
                  <div className="w-18 2xl:w-25 text-center flex-shrink-0">Unique</div>
                  <div className="w-5 flex-shrink-0" />
                </div>

                {/* Columns */}
                {sortedFields.map((field) => {
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
                    />
                  );
                })}
              </div>

              {/* Add Column Button */}
              <div className="border-t border-zinc-200 dark:border-neutral-700 flex justify-center py-3">
                <Button
                  type="button"
                  onClick={addField}
                  variant="outline"
                  className="w-50 h-9 px-2 gap-2 text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:bg-neutral-600 dark:hover:bg-neutral-700 dark:text-white dark:hover:text-white dark:border-transparent"
                >
                  <Plus className="w-5 h-5" />
                  Add Column
                </Button>
              </div>
            </div>

            {/* Foreign Keys Section */}
            <div className="bg-white pb-3 rounded-xl border border-zinc-200 overflow-hidden dark:bg-neutral-800 dark:border-transparent">
              <div className="p-6">
                <h2 className="text-base font-semibold text-black dark:text-white">Foreign Keys</h2>
                <p className="text-sm text-zinc-500 dark:text-neutral-400">
                  Create a relationship between this table and another table
                </p>
              </div>

              {/* Existing foreign keys */}
              {foreignKeys.length > 0 && (
                <div className="px-6 pb-6 space-y-3 overflow-x-auto">
                  {foreignKeys.map((fk) => (
                    <div
                      key={fk.columnName}
                      className="group flex items-center gap-6 2xl:gap-8 pl-4 pr-2 py-2 w-min xl:w-full rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 transition-colors duration-150 dark:bg-neutral-700 dark:border-transparent dark:hover:bg-neutral-600"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-[188px] overflow-hidden">
                        <Link className="flex-shrink-0 w-5 h-5 text-zinc-500 dark:text-neutral-400" />
                        <span className="font-medium text-sm text-zinc-950 dark:text-white truncate">
                          {fk.columnName}
                        </span>
                        <MoveRight className="flex-shrink-0 w-5 h-5 text-zinc-950 dark:text-neutral-400" />
                        <span className="font-medium text-sm text-zinc-950 dark:text-white flex-1 truncate">
                          {fk.referenceTable}.{fk.referenceColumn}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 w-45">
                        <span className="font-medium text-sm text-zinc-950 dark:text-white whitespace-nowrap">
                          On Update:
                        </span>
                        <span className="text-sm font-medium text-zinc-500 dark:text-neutral-400">
                          {fk.onUpdate}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 w-45">
                        <span className="font-medium text-sm text-zinc-950 dark:text-white whitespace-nowrap">
                          On Delete:
                        </span>
                        <span className="text-sm font-medium text-zinc-500 dark:text-neutral-400">
                          {fk.onDelete}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-10 px-3 gap-1.5 text-zinc-950 hover:bg-zinc-200 transition-colors rounded-md"
                          onClick={() => {
                            setEditingForeignKey(fk.columnName);
                            setShowForeignKeyDialog(true);
                          }}
                        >
                          <Pencil className="w-4 h-4" />
                          <span className="font-medium text-sm">Edit</span>
                        </Button> */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveForeignKey(fk.columnName)}
                          className="h-10 px-3 gap-1.5 text-zinc-950 hover:bg-zinc-200 transition-colors rounded-md dark:bg-neutral-700 dark:text-white dark:group-hover:bg-neutral-600 dark:hover:bg-neutral-500"
                        >
                          <X className="w-4 h-4" />
                          <span className="font-medium text-sm">Remove</span>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Foreign Key Button */}
              <div className="flex justify-center py-3 border-t border-zinc-200 dark:border-neutral-700">
                <Button
                  type="button"
                  variant="outline"
                  className="w-50 h-9 p-2 gap-2 text-sm font-medium text-zinc-950 bg-white border-zinc-200 shadow-sm hover:bg-zinc-50 dark:bg-neutral-600 dark:text-white dark:border-transparent dark:hover:bg-neutral-700"
                  onClick={() => setShowForeignKeyDialog(true)}
                >
                  <Link className="w-5 h-5" />
                  Add Foreign Keys
                </Button>
              </div>

              {/* Foreign Key Popover */}
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
              <Alert variant="destructive" className="dark:bg-neutral-800 dark:text-zinc-300">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </form>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-slate-50 border-t border-zinc-200 px-6 py-3 pb-6 dark:bg-neutral-800 dark:border-neutral-700">
        <div className="flex justify-end gap-3 max-w-[1080px] mx-auto px-6">
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-10 px-4 text-sm font-medium bg-white border border-zinc-200 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] text-zinc-950 hover:bg-zinc-50 dark:bg-neutral-600 dark:border-neutral-600 dark:text-white dark:hover:bg-neutral-700"
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
            className="h-10 px-4 text-sm font-medium bg-zinc-950 text-neutral-50 shadow-sm disabled:opacity-40 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            {mode === 'edit' ? 'Update Table' : 'Save Table'}
          </Button>
        </div>
      </div>
    </div>
  );
}
