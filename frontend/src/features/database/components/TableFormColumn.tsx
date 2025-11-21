import { memo } from 'react';
import { Controller, Control } from 'react-hook-form';
import { X, Key } from 'lucide-react';
import { Input, Checkbox } from '@/components';
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
                className={`w-full h-9 rounded-md border-zinc-200 dark:border-neutral-600 text-sm font-normal dark:placeholder:text-neutral-400 dark:focus:border-white ${
                  isSystemColumn
                    ? 'bg-zinc-100 text-zinc-950 dark:bg-neutral-700 dark:text-zinc-300'
                    : 'bg-white text-zinc-950 shadow-sm dark:bg-neutral-800 dark:text-zinc-300'
                }`}
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
              className={`w-full h-9 rounded-md border-zinc-200 dark:border-neutral-600 text-sm font-normal placeholder:text-zinc-500 dark:placeholder:text-neutral-400 dark:focus:border-white ${
                isSystemColumn
                  ? 'bg-zinc-100 dark:bg-neutral-700 dark:text-zinc-300'
                  : 'bg-white shadow-sm dark:bg-neutral-800 dark:text-zinc-300'
              }`}
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
              onChange={field.onChange}
              disabled={!isNewColumn}
              className={`rounded border-zinc-700 shadow-sm data-[state=checked]:bg-zinc-600 data-[state=checked]:border-zinc-600 dark:bg-neutral-800 dark:text-zinc-300 dark:border-neutral-700`}
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
              onChange={field.onChange}
              disabled={!isNewColumn}
              className={`rounded border-zinc-700 shadow-sm data-[state=checked]:bg-zinc-600 data-[state=checked]:border-zinc-600 dark:bg-neutral-800 dark:text-zinc-300 dark:border-neutral-700`}
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
