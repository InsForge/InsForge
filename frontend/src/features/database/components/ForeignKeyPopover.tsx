import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/radix/Button';
import { Label } from '@/components/radix/Label';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/radix/Dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/radix/Select';
import { metadataService } from '@/features/dashboard/services/metadata.service';
import { apiClient } from '@/lib/api/client';
import { UseFormReturn } from 'react-hook-form';
import { TableFormSchema, TableFormForeignKeySchema } from '../schema';
import { ColumnSchema, OnDeleteActionSchema, OnUpdateActionSchema } from '@insforge/shared-schemas';

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
    reference_table: '',
    reference_column: '',
    on_delete: 'NO ACTION',
    on_update: 'NO ACTION',
  });

  const columns = form.watch('columns');

  // Set initial values when editing
  useEffect(() => {
    if (open && initialValue) {
      setNewForeignKey({
        columnName: initialValue.columnName,
        reference_table: initialValue.reference_table,
        reference_column: initialValue.reference_column,
        on_delete: initialValue.on_delete,
        on_update: initialValue.on_update,
      });
    } else if (!open) {
      // Reset when closing
      setNewForeignKey({
        columnName: '',
        reference_table: '',
        reference_column: '',
        on_delete: 'NO ACTION',
        on_update: 'NO ACTION',
      });
    }
  }, [open, initialValue]);

  // Get available tables
  const { data: metadata } = useQuery({
    queryKey: ['metadata'],
    queryFn: () => metadataService.getAppMetadata(),
    enabled: open,
  });

  const availableTables = metadata?.tables
    ? Object.keys(metadata.tables).filter((table) => mode === 'create' || table !== editTableName)
    : [];

  // Get columns for selected reference table
  const { data: referenceTableSchema } = useQuery({
    queryKey: ['schema', newForeignKey.reference_table],
    queryFn: async () => {
      if (!newForeignKey.reference_table) {
        return null;
      }
      const response = await apiClient.request(
        `/database/tables/${newForeignKey.reference_table}/schema`,
        {
          headers: apiClient.withApiKey(),
        }
      );
      return response;
    },
    enabled: !!newForeignKey.reference_table && open,
  });

  // Calculate if the button should be enabled
  const isAddButtonEnabled = Boolean(
    newForeignKey.columnName && newForeignKey.reference_table && newForeignKey.reference_column
  );

  const handleAddForeignKey = () => {
    if (
      newForeignKey.columnName &&
      newForeignKey.reference_table &&
      newForeignKey.reference_column
    ) {
      onAddForeignKey(newForeignKey);
      setNewForeignKey({
        columnName: '',
        reference_table: '',
        reference_column: '',
        on_delete: 'NO ACTION',
        on_update: 'NO ACTION',
      });
      onOpenChange(false);
    }
  };

  const handleCancelAddForeignKey = () => {
    setNewForeignKey({
      columnName: '',
      reference_table: '',
      reference_column: '',
      on_delete: 'NO ACTION',
      on_update: 'NO ACTION',
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] p-0 gap-0">
        <div className="flex flex-col">
          {/* Header */}
          <div className="flex flex-col gap-1.5 px-6 pt-6 pb-0">
            <DialogTitle className="text-base font-semibold">
              {initialValue ? 'Edit Foreign Key' : 'Add Foreign Key'}
            </DialogTitle>
            <DialogDescription className="text-sm text-zinc-500">
              {initialValue
                ? 'Modify the relationship between tables'
                : 'Create a relationship between this table and another table'}
            </DialogDescription>
          </div>

          {/* Form Content */}
          <div className="flex flex-col gap-6 px-6 py-6">
            {/* Column selector */}
            <div className="flex flex-col gap-3">
              <Label className="text-sm font-medium">Column</Label>
              <Select
                value={newForeignKey.columnName}
                onValueChange={(value) =>
                  setNewForeignKey((prev) => ({ ...prev, columnName: value }))
                }
              >
                <SelectTrigger className="h-10 border-zinc-200 shadow-sm">
                  <SelectValue placeholder="Select column" className="text-zinc-500" />
                </SelectTrigger>
                <SelectContent>
                  {columns
                    .filter((col) => col.name)
                    .map((col, index) => (
                      <SelectItem key={col.name || index} value={col.name}>
                        {col.name} ({col.type})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reference Table selector */}
            <div className="flex flex-col gap-3">
              <Label className="text-sm font-medium">Reference Table</Label>
              <Select
                value={newForeignKey.reference_table}
                onValueChange={(value) => {
                  setNewForeignKey((prev) => ({
                    ...prev,
                    reference_table: value,
                    reference_column: '', // Reset column when table changes
                  }));
                }}
              >
                <SelectTrigger className="h-10 border-zinc-200 shadow-sm">
                  <SelectValue placeholder="Select table" className="text-zinc-500" />
                </SelectTrigger>
                <SelectContent>
                  {availableTables.map((table) => (
                    <SelectItem key={table} value={table}>
                      {table}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reference Column selector - only shown after table is selected */}
            {newForeignKey.reference_table && (
              <div className="flex flex-col gap-3">
                <Label className="text-sm font-medium">Reference Column</Label>
                <Select
                  key={`column-select-${newForeignKey.reference_table}`}
                  value={newForeignKey.reference_column}
                  onValueChange={(value) =>
                    setNewForeignKey((prev) => ({ ...prev, reference_column: value }))
                  }
                >
                  <SelectTrigger className="h-10 border-zinc-200 shadow-sm">
                    <SelectValue placeholder="Select column" className="text-zinc-500" />
                  </SelectTrigger>
                  <SelectContent>
                    {(() => {
                      const allColumns = referenceTableSchema?.columns || [];

                      if (allColumns.length > 0) {
                        // const sourceType = getSourceFieldType();

                        return allColumns.map((col: ColumnSchema) => {
                          // Check if types match exactly
                          // const typesMatch =
                          //   !sourceType || col.type.toLowerCase() === sourceType.toLowerCase();

                          //Disable if not a valid reference or types don't match
                          const isDisabled = !col.is_unique; //|| !typesMatch; This is not working because FieldType and Schema Column Type are incompatible

                          return (
                            <SelectItem key={col.name} value={col.name} disabled={isDisabled}>
                              {col.name} ({col.type}) {col.is_unique && ' (unique)'}
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
            <div className="flex flex-col gap-3">
              <Label className="text-sm font-medium">On Update</Label>
              <Select
                value={newForeignKey.on_update}
                onValueChange={(value) =>
                  setNewForeignKey((prev) => ({
                    ...prev,
                    on_update: value as OnUpdateActionSchema,
                  }))
                }
              >
                <SelectTrigger className="h-10 border-zinc-200 shadow-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NO ACTION">No Action</SelectItem>
                  <SelectItem value="CASCADE">Cascade</SelectItem>
                  <SelectItem value="RESTRICT">Restrict</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* On Delete action */}
            <div className="flex flex-col gap-3">
              <Label className="text-sm font-medium">On Delete</Label>
              <Select
                value={newForeignKey.on_delete}
                onValueChange={(value) =>
                  setNewForeignKey((prev) => ({
                    ...prev,
                    on_delete: value as OnDeleteActionSchema,
                  }))
                }
              >
                <SelectTrigger className="h-10 border-zinc-200 shadow-sm">
                  <SelectValue />
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
          <div className="flex justify-end gap-3 px-6 pb-6">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelAddForeignKey}
              className="h-10 px-4"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAddForeignKey}
              disabled={!isAddButtonEnabled}
              className={`h-10 px-4 ${
                !isAddButtonEnabled ? 'bg-zinc-950/40' : 'bg-zinc-950'
              } text-white shadow-sm`}
            >
              {initialValue ? 'Update Foreign Key' : 'Add Foreign Key'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
