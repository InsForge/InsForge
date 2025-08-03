import { memo } from 'react';
import { Controller, Control } from 'react-hook-form';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/radix/Select';
import { columnTypeIcons } from '../constants';
import { TableFormSchema } from '../schema';
import { columnTypeSchema } from '@insforge/shared-schemas';

const COLUMN_TYPES_ARRAY = columnTypeSchema.options;

// Pre-render select options to avoid re-creating them on every render
const SELECT_OPTIONS = COLUMN_TYPES_ARRAY.map((type) => {
  const TypeIcon = columnTypeIcons[type];
  return (
    <SelectItem key={type} value={type}>
      <div className="flex items-center gap-2">
        <TypeIcon className="h-4 w-4" />
        <span>{type}</span>
      </div>
    </SelectItem>
  );
});

interface ColumnTypeSelectProps {
  control: Control<TableFormSchema>;
  name: `columns.${number}.type`;
  disabled?: boolean;
  className: string;
}

export const ColumnTypeSelect = memo(function TableFormSelect({
  control,
  name,
  disabled,
  className,
}: ColumnTypeSelectProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const Icon = columnTypeIcons[field.value];
        return (
          <Select disabled={disabled} value={field.value} onValueChange={field.onChange}>
            <SelectTrigger className={className}>
              <div className="flex items-center gap-2">
                {Icon && <Icon className="h-4 w-4 text-zinc-500" />}
                <span>{field.value}</span>
              </div>
            </SelectTrigger>
            <SelectContent>{SELECT_OPTIONS}</SelectContent>
          </Select>
        );
      }}
    />
  );
});
