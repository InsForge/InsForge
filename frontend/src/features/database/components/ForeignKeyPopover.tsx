import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/radix/Button';
import { Label } from '@/components/radix/Label';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/radix/Dialog';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/radix/Select';
import { useTables } from '@/features/database/hooks/useTables';
import { UseFormReturn } from 'react-hook-form';
import { TableFormSchema, TableFormForeignKeySchema } from '../schema';
import { ColumnSchema, OnDeleteActionSchema, OnUpdateActionSchema } from '@insforge/shared-schemas';
import { cn } from '@/lib/utils/utils';

interface ForeignKeyPopoverProps {
  form: UseFormReturn<TableFormSchema>;
  mode: 'create' | 'edit';
  editTableName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddForeignKey: (fk: TableFormForeignKeySchema) => void;
  initialValue?: TableFormForeignKeySchema;
}

export function ForeignKeyPopover({
  form,
  mode,
  editTableName,
  open,
  onOpenChange,
  onAddForeignKey,
  initialValue,
}: ForeignKeyPopoverProps) {
  const [newForeignKey, setNewForeignKey] = useState<TableFormForeignKeySchema>({
    columnName: '',
    referenceTable: '',
    referenceColumn: '',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  });

  const columns = form.watch('columns');
  const { tables, useTableSchema } = useTables();

  // Set initial values when editing
  useEffect(() => {
    if (open && initialValue) {
      setNewForeignKey({
        columnName: initialValue.columnName,
        referenceTable: initialValue.referenceTable,
        referenceColumn: initialValue.referenceColumn,
        onDelete: initialValue.onDelete,
        onUpdate: initialValue.onUpdate,
      });
    } else if (!open) {
      // Reset when closing
      setNewForeignKey({
        columnName: '',
        referenceTable: '',
        referenceColumn: '',
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      });
    }
  }, [open, initialValue]);

  // Get available tables
  const availableTables = tables.filter(
    (tableName) => mode === 'create' || tableName !== editTableName
  );

  // Get columns for selected reference table
  const { data: referenceTableSchema } = useTableSchema(
    newForeignKey.referenceTable || '',
    !!newForeignKey.referenceTable && open
  );

  // Get the type of the selected source column
  const getSourceFieldType = useMemo(() => {
    if (!newForeignKey.columnName) {
      return null;
    }
    const sourceColumn = columns.find((col) => col.columnName === newForeignKey.columnName);
    return sourceColumn?.type || null;
  }, [newForeignKey.columnName, columns]);

  // Calculate if the button should be enabled
  const isAddButtonEnabled = Boolean(
    newForeignKey.columnName && newForeignKey.referenceTable && newForeignKey.referenceColumn
  );

  const handleAddForeignKey = () => {
    if (newForeignKey.columnName && newForeignKey.referenceTable && newForeignKey.referenceColumn) {
      onAddForeignKey(newForeignKey);
      setNewForeignKey({
        columnName: '',
        referenceTable: '',
        referenceColumn: '',
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      });
      onOpenChange(false);
    }
  };

  const handleCancelAddForeignKey = () => {
    setNewForeignKey({
      columnName: '',
      referenceTable: '',
      referenceColumn: '',
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] p-0 gap-0">
        <div className="flex flex-col">
          {/* Header */}
          <div className="flex flex-col gap-1 px-6 py-3 border-b border-zinc-200 dark:border-neutral-700">
            <DialogTitle className="text-lg font-semibold dark:text-white">
              {initialValue ? 'Edit Foreign Key' : 'Add Foreign Key'}
            </DialogTitle>
            <DialogDescription className="text-sm text-zinc-500 dark:text-neutral-400">
              {initialValue
                ? 'Modify the relationship between tables'
                : 'Create a relationship between this table and another table'}
            </DialogDescription>
          </div>

          {/* Form Content */}
          <div className="flex flex-col gap-6 p-6">
            {/* Column selector */}
            <div className="flex flex-row gap-10 items-center">
              <Label className="text-sm text-black dark:text-white flex-1">Column</Label>
              <Select
                value={newForeignKey.columnName}
                onValueChange={(value) =>
                  setNewForeignKey((prev) => ({ ...prev, columnName: value }))
                }
              >
                <SelectTrigger className="w-70 h-10 border-zinc-200 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                  <span
                    className={cn(
                      'text-sm text-muted-foreground dark:text-neutral-400',
                      newForeignKey.columnName && 'text-black dark:text-white'
                    )}
                  >
                    {newForeignKey.columnName || 'Select column'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {columns
                    .filter((col) => col.columnName)
                    .map((col, index) => (
                      <SelectItem
                        key={col.columnName || index}
                        value={col.columnName}
                        disabled={col.isSystemColumn}
                      >
                        <div className="flex flex-row items-center justify-between gap-2">
                          <span className="truncate max-w-[160px] block">{col.columnName}</span>
                          <span className="text-xs text-muted-foreground dark:text-neutral-400 flex-shrink-0">
                            ({col.type})
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reference Table selector */}
            <div className="flex flex-row gap-10 items-center">
              <Label className="text-sm text-black dark:text-white flex-1">Reference Table</Label>
              <Select
                value={newForeignKey.referenceTable}
                onValueChange={(value) => {
                  setNewForeignKey((prev) => ({
                    ...prev,
                    referenceTable: value,
                    referenceColumn: '', // Reset column when table changes
                  }));
                }}
              >
                <SelectTrigger className="w-70 h-10 border-zinc-200 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                  <span
                    className={cn(
                      'text-sm text-muted-foreground dark:text-neutral-400',
                      newForeignKey.referenceTable && 'text-black dark:text-white'
                    )}
                  >
                    {newForeignKey.referenceTable || 'Select table'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {availableTables.map((tableName) => (
                    <SelectItem key={tableName} value={tableName}>
                      {tableName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reference Column selector - only shown after table and source column are selected */}
            {newForeignKey.referenceTable && newForeignKey.columnName && (
              <div className="flex flex-row gap-10 items-center">
                <Label className="text-sm text-black dark:text-white flex-1">
                  Reference Column
                </Label>
                <Select
                  key={`column-select-${newForeignKey.referenceTable}`}
                  value={newForeignKey.referenceColumn}
                  onValueChange={(value) =>
                    setNewForeignKey((prev) => ({ ...prev, referenceColumn: value }))
                  }
                >
                  <SelectTrigger className="w-70 h-10 border-zinc-200 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                    <span
                      className={cn(
                        'text-sm text-muted-foreground dark:text-neutral-400',
                        newForeignKey.referenceColumn && 'text-black dark:text-white'
                      )}
                    >
                      {newForeignKey.referenceColumn || 'Select column'}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="max-w-[360px]">
                    {(() => {
                      const allColumns = referenceTableSchema?.columns || [];
                      if (allColumns.length) {
                        const sourceType = getSourceFieldType;

                        return allColumns.map((col: ColumnSchema) => {
                          // Check if types match exactly (sourceType should always exist at this point since we require columnName)
                          const typesMatch =
                            sourceType && col.type.toLowerCase() === sourceType.toLowerCase();

                          // Disable if not a valid reference or types don't match
                          const isDisabled = !col.isUnique || !typesMatch;

                          // Determine what to show on the right side
                          let rightText = '';
                          if (!col.isUnique) {
                            rightText = 'Not unique';
                          } else if (!typesMatch) {
                            rightText = 'Columntype not match';
                          }

                          return (
                            <SelectItem
                              key={col.columnName}
                              value={col.columnName}
                              disabled={isDisabled}
                              className="relative flex items-center justify-between pr-16"
                            >
                              <div className="flex flex-row items-center justify-between gap-2">
                                <span
                                  className="flex-1 truncate max-w-[180px] block"
                                  title={col.columnName}
                                >
                                  {col.columnName}
                                </span>
                                <span className="text-xs text-muted-foreground dark:text-neutral-400">
                                  ({col.type})
                                </span>
                                {rightText && (
                                  <span className="text-right text-xs text-muted-foreground dark:text-neutral-400">
                                    {rightText}
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          );
                        });
                      }

                      return (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          No columns available
                        </div>
                      );
                    })()}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* On Update action */}
            <div className="flex flex-row gap-10 items-center">
              <Label className="text-sm text-black dark:text-white flex-1">On Update</Label>
              <Select
                value={newForeignKey.onUpdate}
                onValueChange={(value) =>
                  setNewForeignKey((prev) => ({
                    ...prev,
                    onUpdate: value as OnUpdateActionSchema,
                  }))
                }
              >
                <SelectTrigger className="w-70 h-10 border-zinc-200 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                  <span className="text-sm text-black dark:text-white">
                    {newForeignKey.onUpdate}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NO ACTION">No Action</SelectItem>
                  <SelectItem value="CASCADE">Cascade</SelectItem>
                  <SelectItem value="RESTRICT">Restrict</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* On Delete action */}
            <div className="flex flex-row gap-10 items-center">
              <Label className="text-sm text-black dark:text-white flex-1">On Delete</Label>
              <Select
                value={newForeignKey.onDelete}
                onValueChange={(value) =>
                  setNewForeignKey((prev) => ({
                    ...prev,
                    onDelete: value as OnDeleteActionSchema,
                  }))
                }
              >
                <SelectTrigger className="w-70 h-10 border-zinc-200 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                  <span className="text-sm text-black dark:text-white">
                    {newForeignKey.onDelete}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NO ACTION">No Action</SelectItem>
                  <SelectItem value="CASCADE">Cascade</SelectItem>
                  <SelectItem value="SET NULL">Set Null</SelectItem>
                  <SelectItem value="SET DEFAULT">Set Default</SelectItem>
                  <SelectItem value="RESTRICT">Restrict</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 p-6 border-t border-zinc-200 dark:border-neutral-700">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelAddForeignKey}
              className="h-10 px-4 dark:bg-neutral-600 dark:text-white dark:border-transparent dark:hover:bg-neutral-700"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAddForeignKey}
              disabled={!isAddButtonEnabled}
              className={`h-10 px-4 ${
                !isAddButtonEnabled
                  ? 'bg-zinc-950/40 dark:bg-emerald-300/40'
                  : 'bg-zinc-950 dark:text-zinc-950 dark:bg-emerald-300 dark:hover:bg-emerald-400'
              } text-white dark:text-zinc-950 shadow-sm`}
            >
              {initialValue ? 'Update Foreign Key' : 'Add Foreign Key'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
