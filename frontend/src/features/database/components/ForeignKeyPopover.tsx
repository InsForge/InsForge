import { useState, useEffect, useMemo } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@insforge/ui';
import { Label } from '@/components';
import { useTables } from '@/features/database/hooks/useTables';
import { UseFormReturn } from 'react-hook-form';
import { TableFormSchema, TableFormForeignKeySchema } from '../schema';
import { ColumnSchema, OnDeleteActionSchema, OnUpdateActionSchema } from '@insforge/shared-schemas';
import { cn } from '@/lib/utils/utils';

const ACTION_LABELS: Record<string, string> = {
  'NO ACTION': 'No Action',
  CASCADE: 'Cascade',
  RESTRICT: 'Restrict',
  'SET NULL': 'Set Null',
  'SET DEFAULT': 'Set Default',
};
import { AUTH_USERS_TABLE } from '../constants';

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

  // Get available tables (include auth.users as a special option)
  const availableTables = [
    AUTH_USERS_TABLE,
    ...tables.filter((tableName) => mode === 'create' || tableName !== editTableName),
  ];

  // Get columns for selected reference table (skip fetch for auth.users)
  const isAuthUsers = newForeignKey.referenceTable === AUTH_USERS_TABLE;
  const { data: fetchedTableSchema } = useTableSchema(
    newForeignKey.referenceTable || '',
    !!newForeignKey.referenceTable && !isAuthUsers && open
  );

  // Use hardcoded schema for auth.users, otherwise use fetched schema
  const referenceTableSchema = isAuthUsers
    ? {
        columns: [{ columnName: 'id', type: 'uuid', isUnique: true, isNullable: false }],
      }
    : fetchedTableSchema;

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
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{initialValue ? 'Edit Foreign Key' : 'Add Foreign Key'}</DialogTitle>
          <DialogDescription>
            {initialValue
              ? 'Modify the relationship between tables'
              : 'Create a relationship between this table and another table'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium text-foreground">Column</Label>
            <Select
              value={newForeignKey.columnName}
              onValueChange={(value) =>
                setNewForeignKey((prev) => ({ ...prev, columnName: value }))
              }
            >
              <SelectTrigger>
                <span
                  className={cn(
                    'text-sm text-muted-foreground',
                    newForeignKey.columnName && 'text-foreground'
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
                      {col.columnName}
                      <span className="text-xs text-muted-foreground">({col.type})</span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium text-foreground">Reference Table</Label>
            <Select
              value={newForeignKey.referenceTable}
              onValueChange={(value) => {
                setNewForeignKey((prev) => ({
                  ...prev,
                  referenceTable: value,
                  referenceColumn: '',
                }));
              }}
            >
              <SelectTrigger>
                <span
                  className={cn(
                    'text-sm text-muted-foreground',
                    newForeignKey.referenceTable && 'text-foreground'
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

          {newForeignKey.referenceTable && newForeignKey.columnName && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm font-medium text-foreground">Reference Column</Label>
              <Select
                key={`column-select-${newForeignKey.referenceTable}`}
                value={newForeignKey.referenceColumn}
                onValueChange={(value) =>
                  setNewForeignKey((prev) => ({ ...prev, referenceColumn: value }))
                }
              >
                <SelectTrigger>
                  <span
                    className={cn(
                      'text-sm text-muted-foreground',
                      newForeignKey.referenceColumn && 'text-foreground'
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
                        const typesMatch =
                          sourceType && col.type.toLowerCase() === sourceType.toLowerCase();
                        const isDisabled = !col.isUnique || !typesMatch;

                        let rightText = '';
                        if (!col.isUnique) {
                          rightText = 'Not unique';
                        } else if (!typesMatch) {
                          rightText = 'Column types mismatch';
                        }

                        return (
                          <SelectItem
                            key={col.columnName}
                            value={col.columnName}
                            disabled={isDisabled}
                          >
                            {col.columnName}
                            <span className="text-xs text-muted-foreground">({col.type})</span>
                            {rightText && (
                              <span className="text-xs text-muted-foreground">{rightText}</span>
                            )}
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

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium text-foreground">On Update</Label>
            <Select
              value={newForeignKey.onUpdate}
              onValueChange={(value) =>
                setNewForeignKey((prev) => ({
                  ...prev,
                  onUpdate: value as OnUpdateActionSchema,
                }))
              }
            >
              <SelectTrigger>
                <span className="text-sm text-foreground">
                  {ACTION_LABELS[newForeignKey.onUpdate] ?? newForeignKey.onUpdate}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NO ACTION">No Action</SelectItem>
                <SelectItem value="CASCADE">Cascade</SelectItem>
                <SelectItem value="RESTRICT">Restrict</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-medium text-foreground">On Delete</Label>
            <Select
              value={newForeignKey.onDelete}
              onValueChange={(value) =>
                setNewForeignKey((prev) => ({
                  ...prev,
                  onDelete: value as OnDeleteActionSchema,
                }))
              }
            >
              <SelectTrigger>
                <span className="text-sm text-foreground">
                  {ACTION_LABELS[newForeignKey.onDelete] ?? newForeignKey.onDelete}
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

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={handleCancelAddForeignKey}
            className="w-30"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleAddForeignKey}
            disabled={!isAddButtonEnabled}
            className="w-30"
          >
            {initialValue ? 'Update Foreign Key' : 'Add Foreign Key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
