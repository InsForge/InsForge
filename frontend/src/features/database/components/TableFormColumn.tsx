import { memo } from 'react';
import { Controller, Control } from 'react-hook-form';
import { X, Key } from 'lucide-react';
import { Checkbox, Input } from '@insforge/ui';
import { TableFormColumnSchema, TableFormSchema } from '../schema';
import { ColumnTypeSelect } from './ColumnTypeSelect';

interface TableFormColumnProps {
  index: number;
  control: Control<TableFormSchema>;
  onRemove: () => void;
  isSystemColumn: boolean;
  isNewColumn: boolean;
  column: TableFormColumnSchema;
}

export const TableFormColumn = memo(function TableFormColumn({
  index,
  control,
  onRemove,
  isSystemColumn,
  isNewColumn,
  column,
}: TableFormColumnProps) {
  return (
    <div
      className={`flex items-center gap-6 px-4 py-2 w-min xl:w-full ${
        isNewColumn ? 'bg-slate-50 dark:bg-neutral-800' : 'bg-white dark:bg-[#2D2D2D]'
      }`}
    >
      {/* Name */}
      <div className="flex-1 min-w-[175px]">
        <div className="relative flex items-center">
          <Controller
            control={control}
            name={`columns.${index}.columnName`}
            render={({ field }) => (
              <Input
                {...field}
                placeholder="Enter column name"
                className="h-9"
                disabled={isSystemColumn}
              />
            )}
          />
          {column.isPrimaryKey && (
            <Key className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          )}
        </div>
      </div>

      {/* Type */}
      <div className="flex-1 min-w-[175px]">
        <ColumnTypeSelect
          control={control}
          name={`columns.${index}.type`}
          disabled={!isNewColumn}
          className={`w-full h-9 rounded-md border-zinc-200 dark:border-neutral-600 text-sm font-normal dark:placeholder:text-neutral-400 ${
            isSystemColumn
              ? 'bg-zinc-100 dark:bg-neutral-700'
              : 'bg-white shadow-sm dark:bg-neutral-800'
          }`}
        />
      </div>

      {/* Default Value */}
      <div className="flex-1 min-w-[175px]">
        <Controller
          control={control}
          name={`columns.${index}.defaultValue`}
          render={({ field }) => (
            <Input
              {...field}
              placeholder="Enter default value"
              className="h-9"
              disabled={isSystemColumn}
            />
          )}
        />
      </div>

      {/* Nullable */}
      <div className="w-18 2xl:w-25 flex justify-center flex-shrink-0">
        <Controller
          control={control}
          name={`columns.${index}.isNullable`}
          render={({ field }) => (
            <Checkbox
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={!isNewColumn}

            />
          )}
        />
      </div>

      {/* Unique */}
      <div className="w-18 2xl:w-25 flex justify-center flex-shrink-0">
        <Controller
          control={control}
          name={`columns.${index}.isUnique`}
          render={({ field }) => (
            <Checkbox
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={!isNewColumn}

            />
          )}
        />
      </div>

      {/* Delete */}
      <div className="w-5 h-5 flex-shrink-0">
        {!isSystemColumn && (
          <button
            type="button"
            onClick={onRemove}
            className="hover:bg-gray-100 rounded transition-colors dark:hover:bg-neutral-700"
          >
            <X className="w-5 h-5 text-zinc-500 dark:text-zinc-300" />
          </button>
        )}
      </div>
    </div>
  );
});
