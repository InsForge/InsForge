import { memo } from 'react';
import { Controller, Control } from 'react-hook-form';
import { X, Key } from 'lucide-react';
import { Input } from '@/components/radix/Input';
import { Checkbox } from '@/components';
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
      className={`flex items-center gap-6 px-4 py-2 border-t border-zinc-200 ${
        isNewColumn ? 'bg-slate-50' : 'bg-white'
      }`}
    >
      {/* Name */}
      <div className="flex-1 min-w-[175px]">
        <div className="relative flex items-center">
          <Controller
            control={control}
            name={`columns.${index}.name`}
            render={({ field }) => (
              <Input
                {...field}
                placeholder="Enter column name"
                className={`w-full h-10 rounded-md border-zinc-200 text-sm font-normal ${
                  isSystemColumn ? 'bg-zinc-100 text-zinc-950' : 'bg-white text-zinc-950 shadow-sm'
                }`}
                disabled={isSystemColumn}
              />
            )}
          />
          {/* Show key icon only for the first preset field in create mode (which is the system id) */}
          {isSystemColumn && column.name === 'id' && (
            <Key className="absolute left-[35px] top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          )}
        </div>
      </div>

      {/* Type */}
      <div className="flex-1 min-w-[175px]">
        <ColumnTypeSelect
          control={control}
          name={`columns.${index}.type`}
          disabled={!isNewColumn}
          className={`w-full h-10 rounded-md border-zinc-200 text-sm font-normal ${
            isSystemColumn ? 'bg-zinc-100' : 'bg-white shadow-sm'
          }`}
        />
      </div>

      {/* Default Value */}
      <div className="flex-1 min-w-[175px]">
        <Controller
          control={control}
          name={`columns.${index}.default_value`}
          render={({ field }) => (
            <Input
              {...field}
              placeholder="Enter default value"
              className={`w-full h-10 rounded-md border-zinc-200 text-sm font-normal placeholder:text-zinc-500 ${
                isSystemColumn ? 'bg-zinc-100' : 'bg-white shadow-sm'
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
          name={`columns.${index}.nullable`}
          render={({ field }) => (
            <Checkbox
              checked={field.value}
              onChange={field.onChange}
              disabled={isSystemColumn}
              className={`rounded border-zinc-700 shadow-sm data-[state=checked]:bg-zinc-600 data-[state=checked]:border-zinc-600`}
            />
          )}
        />
      </div>

      {/* Unique */}
      <div className="w-18 2xl:w-25 flex justify-center flex-shrink-0">
        <Controller
          control={control}
          name={`columns.${index}.is_unique`}
          render={({ field }) => (
            <Checkbox
              checked={field.value}
              onChange={field.onChange}
              disabled={isSystemColumn}
              className={`rounded border-zinc-700 shadow-sm data-[state=checked]:bg-zinc-600 data-[state=checked]:border-zinc-600`}
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
            className="hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5 text-zinc-500" />
          </button>
        )}
      </div>
    </div>
  );
});
