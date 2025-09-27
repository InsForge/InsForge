import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/radix/Select';
import type { BooleanCellEditorProps } from './types';
import { cn } from '@/lib/utils/utils';

export function BooleanCellEditor({
  value,
  nullable,
  onValueChange,
  onCancel,
  className,
}: BooleanCellEditorProps) {
  const [open, setOpen] = useState(true);

  // Convert boolean to string for Select component
  const stringValue = value === null ? 'null' : String(value);

  useEffect(() => {
    // Auto-open the select when component mounts
    setOpen(true);
  }, []);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onCancel();
    }
    setOpen(isOpen);
  };

  return (
    <Select
      value={stringValue}
      onValueChange={onValueChange}
      open={open}
      onOpenChange={handleOpenChange}
    >
      <SelectTrigger
        className={cn(
          'w-full h-full border-0 focus:ring-0 focus:ring-offset-0 p-0 text-black dark:text-white dark:placeholder:text-neutral-400 dark:border-neutral-700',
          className
        )}
      >
        <span>
          {stringValue === 'true' ? 'True' : stringValue === 'false' ? 'False' : stringValue}
        </span>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-25">
        <SelectItem value="true">True</SelectItem>
        <SelectItem value="false">False</SelectItem>
        {nullable && <SelectItem value="null">null</SelectItem>}
      </SelectContent>
    </Select>
  );
}
