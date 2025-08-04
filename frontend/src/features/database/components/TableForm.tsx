import { useState, useEffect, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Plus, X, Link, MoveRight, Pencil } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { Input } from '@/components/radix/Input';
import { Alert, AlertDescription } from '@/components/radix/Alert';
import { databaseService } from '@/features/database/services/database.service';
import {
  TableFormColumnSchema,
  TableFormForeignKeySchema,
  tableFormSchema,
  TableFormSchema,
} from '@/features/database/schema';
import { useToast } from '@/lib/hooks/useToast';
import { TableFormColumn } from './TableFormColumn';
import { ForeignKeyPopover } from './ForeignKeyPopover';
import { ColumnType, TableSchema } from '@insforge/shared-schemas';

// System fields that cannot be modified
const SYSTEM_FIELDS = ['id', 'created_at', 'updated_at'];

const newColumn: TableFormColumnSchema = {
  name: '',
  type: ColumnType.STRING,
  nullable: true,
  is_unique: false,
  default_value: '',
  isSystemColumn: false,
  isNewColumn: true,
};

interface TableFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  mode?: 'create' | 'edit';
  editTable?: TableSchema;
}

export function TableForm({
  open,
  onOpenChange,
  onSuccess,
  mode = 'create',
  editTable,
}: TableFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [showForeignKeyDialog, setShowForeignKeyDialog] = useState(false);
  const [editingForeignKey, setEditingForeignKey] = useState<string>();
  const [foreignKeys, setForeignKeys] = useState<TableFormForeignKeySchema[]>([]);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const form = useForm({
    resolver: zodResolver(tableFormSchema),
    defaultValues: {
      name: '',
      columns:
        mode === 'create'
          ? [
              {
                name: 'id',
                type: ColumnType.UUID,
                default_value: 'gen_random_uuid()',
                nullable: false,
                is_unique: true,
                isSystemColumn: true,
                isNewColumn: false,
              },
              {
                name: 'created_at',
                type: ColumnType.DATETIME,
                default_value: 'CURRENT_TIMESTAMP',
                nullable: true,
                is_unique: false,
                isSystemColumn: true,
                isNewColumn: false,
              },
              {
                name: 'updated_at',
                type: ColumnType.DATETIME,
                default_value: 'CURRENT_TIMESTAMP',
                nullable: true,
                is_unique: false,
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
        name: editTable.table_name,
        columns: editTable.columns.map((col) => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          is_unique: col.is_unique || false,
          default_value: col.default_value || '',
          originalName: col.name, // Track original name for rename detection
          isSystemColumn: SYSTEM_FIELDS.includes(col.name),
          isNewColumn: false,
        })),
      });

      // Set foreign keys from editTable
      const existingForeignKeys = editTable.columns
        .filter((col) => !SYSTEM_FIELDS.includes(col.name) && col.foreign_key)
        .map((col) => ({
          columnName: col.name,
          reference_table: col.foreign_key?.reference_table ?? '',
          reference_column: col.foreign_key?.reference_column ?? '',
          on_delete: col.foreign_key?.on_delete || 'NO ACTION',
          on_update: col.foreign_key?.on_update || 'NO ACTION',
        }));
      setForeignKeys(existingForeignKeys);
    } else {
      form.reset({
        name: '',
        columns: [
          {
            name: 'id',
            type: ColumnType.UUID,
            default_value: 'gen_random_uuid()',
            nullable: false,
            is_unique: true,
            isSystemColumn: true,
            isNewColumn: false,
          },
          {
            name: 'created_at',
            type: ColumnType.DATETIME,
            default_value: 'CURRENT_TIMESTAMP',
            nullable: true,
            is_unique: false,
            isSystemColumn: true,
            isNewColumn: false,
          },
          {
            name: 'updated_at',
            type: ColumnType.DATETIME,
            default_value: 'CURRENT_TIMESTAMP',
            nullable: true,
            is_unique: false,
            isSystemColumn: true,
            isNewColumn: false,
          },
          { ...newColumn },
        ],
      });
      setForeignKeys([]);
    }
  }, [mode, editTable, form, open]);

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

      // Within system fields, maintain the order: id, created_at, updated_at
      if (a.isSystemColumn && b.isSystemColumn) {
        return SYSTEM_FIELDS.indexOf(a.name) - SYSTEM_FIELDS.indexOf(b.name);
      }

      // Keep original order for non-system fields
      return 0;
    });
  }, [fields]);

  const createTableMutation = useMutation({
    mutationFn: (data: TableFormSchema) => {
      const columns = data.columns.map((col) => {
        // Find foreign key for this field if it exists
        const foreignKey = foreignKeys.find((fk) => fk.columnName === col.name);

        return {
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          is_unique: col.is_unique,
          default_value: col.default_value,
          // Embed foreign key information directly in the column
          ...(foreignKey && {
            foreign_key: {
              reference_table: foreignKey.reference_table,
              reference_column: foreignKey.reference_column,
              on_delete: foreignKey.on_delete,
              on_update: foreignKey.on_update,
            },
          }),
        };
      });

      return databaseService.createTable(data.name, columns);
    },
    onSuccess: (_) => {
      void queryClient.invalidateQueries({ queryKey: ['metadata'] });
      void queryClient.invalidateQueries({ queryKey: ['tables'] });

      showToast('Table created successfully!', 'success');

      onOpenChange(false);
      form.reset();
      setError(null);
      setForeignKeys([]);
      onSuccess?.();
    },
    onError: (err) => {
      const errorMessage = err.message || 'Failed to create table';
      setError(errorMessage);
      showToast('Failed to create table', 'error');
    },
  });

  const updateTableMutation = useMutation({
    mutationFn: (data: TableFormSchema) => {
      if (!editTable) {
        return Promise.resolve();
      }

      // System columns that cannot be modified
      const SYSTEM_FIELDS = ['id', 'created_at', 'updated_at'];

      // Compare fields to determine what operations to perform
      const operations = {
        add_columns: [] as any[],
        drop_columns: [] as any[],
        rename_columns: {} as Record<string, string>,
        add_fkey_columns: [] as any[],
        drop_fkey_columns: [] as any[],
      };

      // Filter out system columns from existing fields for comparison
      const existingUserColumns = editTable.columns.filter(
        (col) => !SYSTEM_FIELDS.includes(col.name)
      );

      // Track which original columns we've seen
      const processedOriginalColumns = new Set<string>();

      // Process each field
      data.columns.forEach((col) => {
        if (col.originalName) {
          // This field existed before
          processedOriginalColumns.add(col.originalName);

          // Check if it was renamed
          if (col.originalName !== col.name) {
            operations['rename_columns'][col.originalName] = col.name;
          }
        } else {
          // This is a new field (added via Add Field button)
          const { ...fieldData } = col;
          operations['add_columns'].push({
            ...fieldData,
            default_value: fieldData.default_value || undefined,
          });
        }
      });

      // Find dropped columns
      existingUserColumns.forEach((col) => {
        if (!processedOriginalColumns.has(col.name)) {
          operations['drop_columns'].push({
            name: col.name,
          });
        }
      });

      // Handle foreign keys
      // Get existing foreign keys from editTable
      const existingForeignKeys = existingUserColumns
        .filter((col) => col.foreign_key)
        .map((col) => ({
          columnName: col.name,
          ...col.foreign_key,
        }));

      // Compare with new foreign keys
      foreignKeys.forEach((fk) => {
        const existingFK = existingForeignKeys.find((efk) => efk.columnName === fk.columnName);

        if (!existingFK) {
          // This is a new foreign key
          operations['add_fkey_columns'].push({
            name: fk.columnName,
            foreign_key: {
              reference_table: fk.reference_table,
              reference_column: fk.reference_column,
              on_delete: fk.on_delete,
              on_update: fk.on_update,
            },
          });
        }
      });

      // Check for dropped foreign keys
      existingForeignKeys.forEach((efk) => {
        const stillExists = foreignKeys.find((fk) => fk.columnName === efk.columnName);
        if (!stillExists) {
          // This foreign key was removed
          operations['drop_fkey_columns'].push({
            name: efk.columnName,
          });
        }
      });

      return databaseService.modifyTable(data.name, operations);
    },
    onSuccess: (_, data) => {
      void queryClient.invalidateQueries({ queryKey: ['metadata'] });
      void queryClient.invalidateQueries({ queryKey: ['tables'] });

      // Invalidate all table data queries for this table (with all parameter combinations)
      void queryClient.invalidateQueries({ queryKey: ['table', editTable?.table_name] });

      // Invalidate the separate table schema query used by AddRecordSheet
      void queryClient.invalidateQueries({ queryKey: ['table-schema', editTable?.table_name] });

      showToast(`Table "${data.name}" updated successfully!`, 'success');

      onOpenChange(false);
      form.reset();
      setError(null);
      setForeignKeys([]);
      onSuccess?.();
    },
    onError: (err) => {
      // Invalidate queries to ensure we have fresh data after failed request
      void queryClient.invalidateQueries({ queryKey: ['table', editTable?.table_name] });
      void queryClient.invalidateQueries({ queryKey: ['table-schema', editTable?.table_name] });

      const errorMessage = err.message || 'Failed to update table';
      setError(errorMessage);
      showToast('Failed to update table', 'error');
    },
  });

  const handleSubmit = form.handleSubmit((data) => {
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
    } else {
      // Add new foreign key
      setForeignKeys([
        ...foreignKeys,
        {
          ...fk,
        },
      ]);
    }
  };

  const handleRemoveForeignKey = (columnName?: string) => {
    setForeignKeys(foreignKeys.filter((fk) => fk.columnName !== columnName));
  };

  if (!open) {
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Content area with slate background */}
      <div className="flex-1 bg-slate-100 flex flex-col items-center overflow-auto">
        <div className="flex flex-col gap-6 w-full max-w-[1080px] px-6 py-6">
          {/* Title Bar */}
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-black">
              {mode === 'edit' ? 'Edit Table' : 'Create New Table'}
            </h1>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex items-center justify-center w-12 h-12 bg-white rounded-full border border-zinc-200 shadow-sm hover:bg-gray-50 transition-colors"
            >
              <X className="w-5 h-5 text-zinc-500" />
            </button>
          </div>

          <form onSubmit={() => void handleSubmit()} className="flex flex-col gap-6">
            {/* Table Name */}
            <div className="bg-white rounded-xl border border-zinc-200 p-6">
              <div className="flex flex-col gap-3">
                <label className="text-sm font-medium text-zinc-950">Table Name</label>
                <Input
                  {...form.register('name')}
                  placeholder="e.g., products, orders, customers"
                  className="h-10 rounded-md border-zinc-200 shadow-sm placeholder:text-zinc-500"
                  disabled={mode === 'edit'}
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
                )}
              </div>
            </div>

            {/* Columns Section */}
            <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
              {/* Columns Header */}
              <div className="px-6 py-3 bg-white">
                <h2 className="text-base font-semibold text-black mb-3">Columns</h2>
              </div>

              {/* Columns Table */}
              <div className="pb-6 overflow-x-auto">
                {/* Table Headers */}
                <div className="flex items-center gap-6 px-7 py-2 bg-slate-50 rounded-t text-sm font-medium text-zinc-950">
                  <div className="flex-1 min-w-[175px]">Name</div>
                  <div className="flex-1 min-w-[175px]">Type</div>
                  <div className="flex-1 min-w-[175px]">Default Value</div>
                  <div className="w-18 2xl:w-25 text-center flex-shrink-0">Nullable</div>
                  <div className="w-18 2xl:w-25 text-center flex-shrink-0">Unique</div>
                  <div className="w-5 flex-shrink-0" />
                </div>

                {/* Columns */}
                <div className="px-3 border-b border-zinc-200">
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
                <div className="flex justify-center mt-3">
                  <Button
                    type="button"
                    onClick={addField}
                    variant="outline"
                    className="w-50 h-10 px-3 text-sm font-medium text-zinc-700 hover:text-zinc-950"
                  >
                    <Plus className="w-4 h-4" />
                    Add Column
                  </Button>
                </div>
              </div>
            </div>

            {/* Foreign Keys Section */}
            <div className="bg-white rounded-xl border border-zinc-200">
              <div className="p-6">
                <h2 className="text-base font-semibold text-black">Foreign Keys</h2>
                <p className="text-sm text-zinc-500">
                  Create a relationship between this table and another table
                </p>
              </div>

              {/* Existing foreign keys */}
              {foreignKeys.length > 0 && (
                <div className="px-6 pb-6 space-y-3">
                  {foreignKeys.map((fk) => (
                    <div
                      key={fk.columnName}
                      className="group flex items-center gap-6 2xl:gap-8 pl-4 pr-2 py-2 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-100 transition-colors duration-150"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-[188px] overflow-hidden">
                        <Link className="flex-shrink-0 w-5 h-5 text-zinc-500" />
                        <span className="font-medium text-sm text-zinc-950 truncate">
                          {fk.columnName}
                        </span>
                        <MoveRight className="flex-shrink-0 w-5 h-5 text-zinc-950" />
                        <span className="font-medium text-sm text-zinc-950 flex-1 truncate">
                          {fk.reference_table}.{fk.reference_column}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 w-47">
                        <span className="font-medium text-sm text-zinc-950 whitespace-nowrap">
                          On Update:
                        </span>
                        <span className="text-sm text-zinc-500">{fk.on_update}</span>
                      </div>
                      <div className="flex items-center gap-2 w-47">
                        <span className="font-medium text-sm text-zinc-950 whitespace-nowrap">
                          On Delete:
                        </span>
                        <span className="text-sm text-zinc-500">{fk.on_delete}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Button
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
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveForeignKey(fk.columnName)}
                          className="h-10 px-3 gap-1.5 text-zinc-950 hover:bg-zinc-200 transition-colors rounded-md"
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
              <div className="flex justify-center py-3 border-t border-zinc-200">
                <Button
                  type="button"
                  variant="outline"
                  className="w-[200px] h-10 px-3 gap-1.5 text-sm font-medium text-zinc-950 bg-white border-zinc-200 shadow-sm hover:bg-zinc-50"
                  onClick={() => setShowForeignKeyDialog(true)}
                >
                  <Link className="w-4 h-4 mr-1" />
                  Add Foreign Keys
                </Button>
              </div>

              {/* Foreign Key Popover */}
              <ForeignKeyPopover
                form={form}
                mode={mode}
                editTableName={editTable?.table_name}
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
      </div>

      {/* Footer */}
      <div className="bg-slate-50 border-t border-zinc-200 px-6 py-3 pb-6">
        <div className="flex justify-end gap-3 max-w-[1080px] mx-auto px-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 px-4 text-sm font-medium border-zinc-200 shadow-sm"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={
              !form.formState.isValid ||
              createTableMutation.isPending ||
              updateTableMutation.isPending
            }
            className="h-10 px-4 text-sm font-medium bg-zinc-950 text-neutral-50 shadow-sm disabled:opacity-40"
          >
            {mode === 'edit' ? 'Update Table' : 'Save Table'}
          </Button>
        </div>
      </div>
    </div>
  );
}
