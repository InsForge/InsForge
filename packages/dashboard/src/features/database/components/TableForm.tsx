import { useState, useEffect, useMemo, useRef } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Plus, X, Link, MoveRight } from 'lucide-react';
import { Button, Input, useToast } from '@insforge/ui';
import { Alert, AlertDescription } from '#components';
import { tableService } from '#features/database/services/table.service';
import {
  TableFormColumnSchema,
  TableFormForeignKeySchema,
  tableFormForeignKeySchema,
  tableFormSchema,
  TableFormSchema,
} from '#features/database/schema';
import { TableFormColumn } from './TableFormColumn';
import { ForeignKeyPopover } from './ForeignKeyPopover';
import { ColumnType, TableSchema, UpdateTableSchemaRequest } from '@insforge/shared-schemas';
import { parseDatabaseTableReference, SYSTEM_FIELDS } from '#features/database/helpers';
import { databaseTableQueryKeys } from '#features/database/queryKeys';
import { useProjectId } from '#lib/hooks/useMetadata';
import {
  getLocalStorageJSON,
  removeLocalStorageItem,
  setLocalStorageJSON,
} from '#lib/utils/local-storage';

const newColumn: TableFormColumnSchema = {
  columnName: '',
  type: ColumnType.STRING,
  isNullable: true,
  isUnique: false,
  defaultValue: '',
  isSystemColumn: false,
  isNewColumn: true,
};

const TABLE_FORM_CREATE_DRAFT_STORAGE_KEY = 'table-form-columns-draft';

export const getTableFormCreateDraftStorageKey = (
  draftScope?: string,
  schemaName?: string
): string => {
  const keyParts = [TABLE_FORM_CREATE_DRAFT_STORAGE_KEY];

  if (draftScope) {
    keyParts.push(encodeURIComponent(draftScope));
  }

  if (schemaName) {
    keyParts.push(encodeURIComponent(schemaName));
  }

  return keyParts.join(':');
};

interface TableFormCreateDraft {
  schemaName: string;
  tableName: string;
  columns: TableFormColumnSchema[];
  foreignKeys: TableFormForeignKeySchema[];
}

const createDefaultColumns = (): TableFormColumnSchema[] => [
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
];

const getRecordValue = (value: unknown, key: string): unknown => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
};

const hasColumnDraftData = (column: TableFormColumnSchema): boolean => {
  return (
    column.columnName.trim().length > 0 ||
    (column.defaultValue ?? '').trim().length > 0 ||
    column.type !== newColumn.type ||
    column.isNullable !== newColumn.isNullable ||
    column.isUnique !== newColumn.isUnique
  );
};

const hasUserColumnDraftData = (columns: TableFormColumnSchema[]): boolean => {
  return columns.some((column) => !column.isSystemColumn && hasColumnDraftData(column));
};

const hasCreateDraftData = (draft: TableFormCreateDraft): boolean => {
  return (
    draft.tableName.trim().length > 0 ||
    hasUserColumnDraftData(draft.columns) ||
    draft.foreignKeys.length > 0
  );
};

const readTableFormCreateDraft = (
  draftScope?: string,
  schemaName?: string
): TableFormCreateDraft | null => {
  try {
    const parsedValue = getLocalStorageJSON<unknown>(
      getTableFormCreateDraftStorageKey(draftScope, schemaName)
    );

    const schemaNameValue = getRecordValue(parsedValue, 'schemaName');
    const foreignKeysValue = getRecordValue(parsedValue, 'foreignKeys');
    const formDraft = tableFormSchema.safeParse(parsedValue);

    if (!formDraft.success) {
      return null;
    }

    return {
      schemaName: typeof schemaNameValue === 'string' ? schemaNameValue : '',
      tableName: formDraft.data.tableName,
      columns: formDraft.data.columns,
      foreignKeys: Array.isArray(foreignKeysValue)
        ? foreignKeysValue.flatMap((foreignKey) => {
            const result = tableFormForeignKeySchema.safeParse(foreignKey);
            return result.success ? [result.data] : [];
          })
        : [],
    };
  } catch {
    return null;
  }
};

export const clearTableFormCreateDraft = (draftScope?: string, schemaName?: string) => {
  removeLocalStorageItem(getTableFormCreateDraftStorageKey(draftScope, schemaName));
};

interface TableFormProps {
  schemaName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (newTable?: string) => void;
  mode?: 'create' | 'edit';
  editTable?: TableSchema;
  setFormIsDirty: (dirty: boolean) => void;
}

export function TableForm({
  schemaName,
  open,
  onOpenChange,
  onSuccess,
  mode = 'create',
  editTable,
  setFormIsDirty,
}: TableFormProps) {
  const { projectId, isLoading: isProjectIdLoading } = useProjectId();
  const draftScope = projectId ? `project:${projectId}` : undefined;

  const [error, setError] = useState<string | null>(null);
  const [showForeignKeyDialog, setShowForeignKeyDialog] = useState(false);
  const [editingForeignKey, setEditingForeignKey] = useState<string>();
  const [foreignKeys, setForeignKeys] = useState<TableFormForeignKeySchema[]>([]);
  const [foreignKeysDirty, setForeignKeysDirty] = useState(false);
  const skipNextDraftSaveRef = useRef(true);
  const formScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const form = useForm({
    resolver: zodResolver(tableFormSchema),
    defaultValues: {
      tableName: '',
      columns: mode === 'create' ? createDefaultColumns() : [{ ...newColumn }],
    },
  });

  const tableName = useWatch({
    control: form.control,
    name: 'tableName',
  });
  const columns = useWatch({
    control: form.control,
    name: 'columns',
  });

  useEffect(() => {
    if (open) {
      formScrollRef.current?.scrollTo({ top: 0, left: 0 });
    }
  }, [editTable?.tableName, mode, open, schemaName]);

  useEffect(() => {
    // Clear error when effect runs
    setError(null);

    if (open && mode === 'edit' && editTable) {
      skipNextDraftSaveRef.current = true;
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

      // Set foreign keys from editTable (one entry per table-level constraint)
      const existingForeignKeys = (editTable.foreignKeys ?? []).map((fk) => {
        const { schemaName: referenceSchemaName, tableName: referenceTableName } =
          parseDatabaseTableReference(fk.referenceTable, schemaName);

        return {
          constraintName: fk.constraintName,
          // Stable identity: an existing constraint is uniquely identified by its name.
          uid: fk.constraintName ?? crypto.randomUUID(),
          // Primary source column, used only to associate the FK with a column row in the UI.
          columnName: fk.referenceColumns[0]?.sourceColumn ?? '',
          referenceTable:
            referenceSchemaName === schemaName ? referenceTableName : fk.referenceTable,
          referenceColumns: fk.referenceColumns,
          onDelete: fk.onDelete || 'NO ACTION',
          onUpdate: fk.onUpdate || 'NO ACTION',
        };
      });
      setForeignKeys(existingForeignKeys);
      return;
    }

    if (open && mode === 'create') {
      if (isProjectIdLoading) {
        return;
      }

      const draft = readTableFormCreateDraft(draftScope, schemaName);
      if (draft && (!draft.schemaName || draft.schemaName === schemaName)) {
        skipNextDraftSaveRef.current = true;
        form.reset({
          tableName: draft.tableName,
          columns: draft.columns,
        });
        setForeignKeys(draft.foreignKeys);
        return;
      }

      skipNextDraftSaveRef.current = true;
      form.reset({
        tableName: '',
        columns: createDefaultColumns(),
      });
      setForeignKeys([]);
    }
  }, [draftScope, editTable, form, isProjectIdLoading, mode, open, schemaName]);
  useEffect(() => {
    if (!open || mode !== 'create') {
      return;
    }

    if (isProjectIdLoading) {
      return;
    }

    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }

    const draft: TableFormCreateDraft = {
      schemaName,
      tableName: tableName ?? '',
      columns: columns ?? createDefaultColumns(),
      foreignKeys,
    };

    const draftToSave = {
      ...draft,
      columns: draft.columns.filter(
        (column) => column.isSystemColumn || hasColumnDraftData(column)
      ),
    };

    try {
      if (hasCreateDraftData(draftToSave)) {
        setLocalStorageJSON(getTableFormCreateDraftStorageKey(draftScope, schemaName), draftToSave);
      } else {
        removeLocalStorageItem(getTableFormCreateDraftStorageKey(draftScope, schemaName));
      }
    } catch {
      // Keep the form usable if localStorage is blocked or full.
    }
  }, [columns, draftScope, foreignKeys, isProjectIdLoading, mode, open, schemaName, tableName]);

  const currentCreateDraftHasData =
    mode === 'create' &&
    hasCreateDraftData({
      schemaName,
      tableName: tableName ?? '',
      columns: columns ?? createDefaultColumns(),
      foreignKeys,
    });
  const formHasChanges = form.formState.isDirty || foreignKeysDirty || currentCreateDraftHasData;

  useEffect(() => {
    setFormIsDirty(formHasChanges);
  }, [formHasChanges, setFormIsDirty]);

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
      const columns = data.columns.map((col) => ({
        columnName: col.columnName,
        type: col.type,
        isPrimaryKey: col.isPrimaryKey,
        isNullable: col.isNullable,
        isUnique: col.isUnique,
        defaultValue: col.defaultValue,
      }));

      // Foreign keys are table-level: one entity per constraint.
      const tableForeignKeys = foreignKeys.map((fk) => ({
        referenceTable: fk.referenceTable,
        referenceColumns: fk.referenceColumns,
        onDelete: fk.onDelete,
        onUpdate: fk.onUpdate,
      }));

      return tableService.createTable(schemaName, data.tableName, columns, tableForeignKeys);
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['database-metadata'] });
      void queryClient.invalidateQueries({ queryKey: ['database', 'tables'] });
      void queryClient.invalidateQueries({ queryKey: ['metadata'] });

      showToast('Table created successfully!', 'success');

      clearTableFormCreateDraft(draftScope, schemaName);
      skipNextDraftSaveRef.current = true;
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

      // Handle foreign keys, identified by constraint name (table-level entities).
      const existingForeignKeys = editTable.foreignKeys ?? [];
      const formConstraintNames = new Set(
        foreignKeys.map((fk) => fk.constraintName).filter(Boolean)
      );

      // Newly added FKs have no constraint name yet → add them.
      foreignKeys.forEach((fk) => {
        if (!fk.constraintName) {
          addForeignKeys.push({
            referenceTable: fk.referenceTable,
            referenceColumns: fk.referenceColumns,
            onDelete: fk.onDelete,
            onUpdate: fk.onUpdate,
          });
        }
      });

      // Existing constraints no longer present in the form → drop them by name.
      existingForeignKeys.forEach((efk) => {
        if (efk.constraintName && !formConstraintNames.has(efk.constraintName)) {
          dropForeignKeys.push(efk.constraintName);
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

      return tableService.updateTableSchema(editTable.tableName, operations, schemaName);
    },
    onSuccess: (_, data) => {
      void queryClient.invalidateQueries({ queryKey: ['database-metadata'] });
      void queryClient.invalidateQueries({ queryKey: ['database', 'tables'] });
      void queryClient.invalidateQueries({ queryKey: ['metadata'] });
      if (editTable?.tableName) {
        void queryClient.invalidateQueries({
          queryKey: databaseTableQueryKeys.tableSchema(schemaName, editTable.tableName),
        });
      }
      if (data.tableName !== editTable?.tableName) {
        void queryClient.invalidateQueries({
          queryKey: databaseTableQueryKeys.tableSchema(schemaName, data.tableName),
        });
      }

      // Invalidate all table data queries for this table (with all parameter combinations)
      void queryClient.invalidateQueries({
        queryKey: ['records', schemaName, editTable?.tableName],
      });
      void queryClient.invalidateQueries({ queryKey: ['records', schemaName, data.tableName] });

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
      // Update existing foreign key (matched by stable uid, not source column).
      setForeignKeys(
        foreignKeys.map((existingFk) =>
          existingFk.uid === editingForeignKey ? { ...fk, uid: existingFk.uid } : existingFk
        )
      );
      setEditingForeignKey(undefined);
      setForeignKeysDirty(true);
    } else {
      // Add new foreign key with a fresh client-side identity.
      setForeignKeys([...foreignKeys, { ...fk, uid: crypto.randomUUID() }]);
    }
    setForeignKeysDirty(true);
  };

  const handleRemoveForeignKey = (uid?: string) => {
    // Identify by stable uid so constraints sharing a first source column
    // (e.g. multi-tenant `tenant_id`) are removed individually, not together.
    if (!foreignKeys.some((fk) => fk.uid === uid)) {
      return;
    }
    setForeignKeys(foreignKeys.filter((fk) => fk.uid !== uid));
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

      <div ref={formScrollRef} className="flex-1 overflow-auto px-4 pb-6 sm:px-6 lg:px-10">
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
                      key={fk.uid ?? fk.columnName}
                      className={`group grid h-12 grid-cols-[minmax(260px,1fr)_190px_190px_52px] items-center px-1.5 hover:bg-[var(--alpha-4)] ${
                        index === foreignKeys.length - 1 ? '' : 'border-b border-[var(--alpha-8)]'
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden px-2.5 text-[13px] leading-[18px]">
                        <Link className="size-5 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {fk.referenceColumns.map((c) => c.sourceColumn).join(', ')}
                        </span>
                        <MoveRight className="size-5 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {fk.referenceTable}.
                          {fk.referenceColumns.map((c) => c.referenceColumn).join(', ')}
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
                          onClick={() => handleRemoveForeignKey(fk.uid)}
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
              schemaName={schemaName}
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
                  ? foreignKeys.find((fk) => fk.uid === editingForeignKey)
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
              !formHasChanges
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
