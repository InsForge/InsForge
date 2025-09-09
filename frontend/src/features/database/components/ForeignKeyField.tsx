import React from 'react';
import { Control, Controller } from 'react-hook-form';
import { Button } from '@/components/radix/Button';
import { Link2, X } from 'lucide-react';
import { TypeBadge } from '@/components/TypeBadge';
import { useLinkModal } from '@/features/database/hooks/useLinkModal';
import { ColumnType, ForeignKeySchema } from '@insforge/shared-schemas';
import type { DataGridRow, DatabaseValue } from '@/components/datagrid';

interface ForeignKeyFieldProps {
  foreignKey: ForeignKeySchema;
  type: ColumnType;
  columnName: string;
  isNullable: boolean;
  control: Control<any, any, any>;
  children: React.ReactElement<{ className?: string }>;
}

/**
 * ForeignKeyField component handles form fields that have foreign key relationships.
 * It wraps the field editor with foreign key linking functionality including:
 * - Link button to open record selection modal
 * - Clear button to remove linked record
 * - Foreign key relationship info display
 * - Automatic padding adjustment for buttons
 */
export function ForeignKeyField({
  foreignKey,
  type,
  columnName,
  isNullable,
  control,
  children,
}: ForeignKeyFieldProps) {
  const { openModal } = useLinkModal();

  const handleOpenLinkModal = (
    referenceTable: string,
    referenceColumn: string,
    currentValue: string,
    onChange: (value: DatabaseValue) => void
  ) => {
    openModal({
      referenceTable: referenceTable,
      referenceColumn: referenceColumn,
      currentValue: currentValue,
      onSelectRecord: (record: DataGridRow) => {
        const referenceValue = record[referenceColumn];
        onChange(referenceValue);
      },
    });
  };

  return (
    <Controller
      control={control}
      name={columnName}
      render={({ field: formField }) => {
        const hasLinkedValue =
          type === ColumnType.BOOLEAN
            ? formField.value !== null && formField.value !== undefined
            : formField.value && formField.value !== '';

        return (
          <div className="space-y-1">
            <div className="relative">
              {children}
              <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center">
                {hasLinkedValue && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      // Clear logic based on field type and nullability
                      if (type === ColumnType.BOOLEAN) {
                        // For boolean: null if nullable, false if not nullable
                        formField.onChange(isNullable ? null : false);
                      } else {
                        // For other types: null if nullable, appropriate default if not nullable
                        if (isNullable) {
                          formField.onChange(null);
                        } else {
                          // Set appropriate default value based on type
                          switch (type) {
                            case ColumnType.INTEGER:
                            case ColumnType.FLOAT:
                              formField.onChange(0);
                              break;
                            case ColumnType.STRING:
                            case ColumnType.UUID:
                            default:
                              formField.onChange('');
                              break;
                          }
                        }
                      }
                    }}
                    className="h-7 w-7 p-1 flex-shrink-0 text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:text-neutral-400 dark:hover:text-red-400 dark:hover:bg-red-950/20"
                    title="Clear linked record"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (foreignKey.referenceTable && foreignKey.referenceColumn) {
                      handleOpenLinkModal(
                        foreignKey.referenceTable,
                        foreignKey.referenceColumn,
                        formField.value,
                        formField.onChange
                      );
                    }
                  }}
                  className="rounded-l-none h-9 w-9 p-2 flex-shrink-0 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:text-neutral-400 dark:hover:text-neutral-200 dark:hover:bg-neutral-700 border-l border-zinc-200 dark:border-neutral-700"
                  title={
                    hasLinkedValue
                      ? `Change linked ${foreignKey.referenceTable} record`
                      : `Link to ${foreignKey.referenceTable} record`
                  }
                >
                  <Link2 className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Foreign Key Relationship Info */}
            <div className="text-xs text-medium text-black dark:text-neutral-400 flex items-center gap-1.5">
              <span className="whitespace-nowrap">Has a Foreign Key relation to</span>
              <TypeBadge
                type={`${foreignKey.referenceTable}.${foreignKey.referenceColumn}`}
                className="dark:bg-neutral-700 truncate"
              />
            </div>
          </div>
        );
      }}
    />
  );
}
