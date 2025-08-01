import { Controller, UseFormReturn } from 'react-hook-form';
import { X, Key } from 'lucide-react';
import { Input } from '@/components/radix/Input';
import Checkbox from '@/components/Checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/radix/Select';
import { FIELD_TYPES_ARRAY } from '@/lib/types/schema';
import { fieldIcons } from '../constants';
import { TableFormData } from '../schema';

interface FieldRowProps {
  index: number;
  form: UseFormReturn<TableFormData>;
  onRemove: () => void;
  isSystemField?: boolean;
  isNewField: boolean;
  field: any;
}

export function FieldRow({
  index,
  form,
  onRemove,
  isSystemField = false,
  isNewField,
  field,
}: FieldRowProps) {
  // System fields are the first 3 preset fields in create mode

  return (
    <div
      className={`flex items-center gap-6 px-4 py-2 border-t border-zinc-200 ${
        isSystemField ? 'bg-slate-50' : 'bg-white'
      }`}
    >
      {/* Name */}
      <div className="w-[280px]">
        <div className="relative flex items-center">
          <Input
            {...form.register(`fields.${index}.name`)}
            placeholder="Enter column name"
            className={`h-10 rounded-md border-zinc-200 text-sm font-normal ${
              isSystemField ? 'bg-zinc-100 text-zinc-950' : 'bg-white text-zinc-950 shadow-sm'
            }`}
            disabled={isSystemField}
          />
          {/* Show key icon only for the first preset field in create mode (which is the system id) */}
          {isSystemField && field.name === 'id' && (
            <Key className="absolute left-[35px] top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          )}
        </div>
      </div>

      {/* Type */}
      <div className="w-[200px]">
        <Controller
          control={form.control}
          name={`fields.${index}.type`}
          render={({ field }) => {
            const Icon = fieldIcons[field.value as FieldType];
            return (
              <Select disabled={!isNewField} value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  className={`h-10 rounded-md border-zinc-200 text-sm font-normal ${
                    isSystemField ? 'bg-zinc-100' : 'bg-white shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {Icon && <Icon className="h-4 w-4 text-zinc-500" />}
                    <span>{field.value}</span>
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES_ARRAY.map((type) => {
                    const TypeIcon = fieldIcons[type];
                    return (
                      <SelectItem key={type} value={type}>
                        <div className="flex items-center gap-2">
                          <TypeIcon className="h-4 w-4" />
                          <span>{type}</span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            );
          }}
        />
      </div>

      {/* Default Value */}
      <div className="w-[200px]">
        <Input
          {...form.register(`fields.${index}.default_value`)}
          placeholder="Enter default value"
          className={`h-10 rounded-md border-zinc-200 text-sm font-normal placeholder:text-zinc-500 ${
            isSystemField ? 'bg-zinc-100' : 'bg-white shadow-sm'
          }`}
          disabled={isSystemField}
        />
      </div>

      {/* Nullable */}
      <div className="flex-1 flex justify-center">
        <Checkbox
          checked={form.watch(`fields.${index}.nullable`)}
          onChange={(checked) => form.setValue(`fields.${index}.nullable`, !!checked)}
          disabled={isSystemField}
          className={`rounded border-zinc-700 shadow-sm data-[state=checked]:bg-zinc-600 data-[state=checked]:border-zinc-600`}
        />
      </div>

      {/* Unique */}
      <div className="flex-1 flex justify-center">
        <Checkbox
          checked={form.watch(`fields.${index}.unique`)}
          onChange={(checked) => form.setValue(`fields.${index}.unique`, !!checked)}
          disabled={isSystemField}
          className={`rounded border-zinc-700 shadow-sm data-[state=checked]:bg-zinc-600 data-[state=checked]:border-zinc-600`}
        />
      </div>

      {/* Delete */}
      <div className="w-5 h-5">
        {!isSystemField && (
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
}
