import { memo } from 'react';
import { Controller, Control } from 'react-hook-form';
import { X, Key } from 'lucide-react';
import { Checkbox, Input } from '@insforge/ui';
import { TableFormColumnSchema, TableFormSchema } from '#features/database/schema';
import { ColumnTypeSelect } from './ColumnTypeSelect';

interface TableFormColumnProps {
  index: number;
  control: Control<TableFormSchema>;
  onRemove: () => void;
  isSystemColumn: boolean;
  isNewColumn: boolean;
  isLast: boolean;
  column: TableFormColumnSchema;
}

export const TableFormColumn = memo(function TableFormColumn({
  index,
  control,
  onRemove,
  isSystemColumn,
  isNewColumn,
  isLast,
  column,
}: TableFormColumnProps) {
  return (
    <div
      className={`group flex h-12 items-center pl-1.5 hover:bg-[var(--alpha-4)] ${
        isLast ? '' : 'border-b border-[var(--alpha-8)]'
      }`}
    >
      <div className="flex flex-1 items-center px-2.5">
        <div className="relative flex items-center">
          <Controller
            control={control}
            name={`columns.${index}.columnName`}
            render={({ field }) => (
              <Input
                {...field}
                placeholder="Enter column name"
                className="h-8 bg-[var(--alpha-4)] border-[var(--alpha-12)] pr-8"
                disabled={isSystemColumn}
              />
            )}
          />
          {column.isPrimaryKey && (
            <Key className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          )}
        </div>
      </div>

      <div className="flex flex-1 items-center px-2.5">
        <ColumnTypeSelect
          control={control}
          name={`columns.${index}.type`}
          disabled={!isNewColumn}
          className={`h-8 w-full rounded border-[var(--alpha-12)] bg-[var(--alpha-4)] text-sm font-normal ${
            isSystemColumn ? 'text-muted-foreground' : 'text-foreground'
          }`}
        />
      </div>

      <div className="flex flex-1 items-center px-2.5">
        <Controller
          control={control}
          name={`columns.${index}.defaultValue`}
          render={({ field }) => (
            <Input
              {...field}
              placeholder="Enter default value"
              className="h-8 bg-[var(--alpha-4)] border-[var(--alpha-12)]"
              disabled={isSystemColumn}
            />
          )}
        />
      </div>

      <div className="flex w-[100px] shrink-0 justify-center px-2.5">
        <Controller
          control={control}
          name={`columns.${index}.isNullable`}
          render={({ field }) => (
            <Checkbox
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={!isNewColumn}
              className="border-[var(--alpha-12)] bg-[var(--alpha-4)] data-[state=checked]:border-transparent data-[state=checked]:bg-[rgb(var(--foreground))] data-[state=checked]:text-[rgb(var(--inverse))]"
            />
          )}
        />
      </div>

      <div className="flex w-[100px] shrink-0 justify-center px-2.5">
        <Controller
          control={control}
          name={`columns.${index}.isUnique`}
          render={({ field }) => (
            <Checkbox
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={!isNewColumn}
              className="border-[var(--alpha-12)] bg-[var(--alpha-4)] data-[state=checked]:border-transparent data-[state=checked]:bg-[rgb(var(--foreground))] data-[state=checked]:text-[rgb(var(--inverse))]"
            />
          )}
        />
      </div>

      <div className="flex w-[52px] shrink-0 items-center justify-end px-2.5">
        {!isSystemColumn && (
          <button
            type="button"
            onClick={onRemove}
            className="flex size-8 items-center justify-center rounded text-muted-foreground opacity-0 transition-[opacity,colors] group-hover:opacity-100 hover:bg-[var(--alpha-8)] hover:text-foreground focus-visible:opacity-100"
            aria-label="Remove column"
          >
            <X className="size-5" />
          </button>
        )}
      </div>
    </div>
  );
});
