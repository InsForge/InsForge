import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@insforge/ui';
import type { BooleanCellEditorProps } from './types';
import { cn } from '#lib/utils/utils';

export function BooleanCellEditor({
  value,
  nullable,
  onValueChange,
  onCancel,
  autoOpen = true,
  className,
}: BooleanCellEditorProps) {
  const [open, setOpen] = useState(autoOpen);

  // Convert boolean to string for Select component
  const stringValue = value === null ? 'null' : String(value);
  const isNullValue = stringValue === 'null';

  useEffect(() => {
    if (autoOpen) {
      // Auto-open the select when component mounts in grid edit mode
      setOpen(true);
    }
  }, [autoOpen]);

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
          'w-full min-h-0 text-[13px] leading-[18px] focus:ring-0 focus:ring-offset-0 [&_svg]:hidden',
          className
        )}
      >
        <span className={cn('truncate', isNullValue && 'text-muted-foreground italic pr-1')}>
          {stringValue === 'true' ? 'True' : stringValue === 'false' ? 'False' : 'null'}
        </span>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-25">
        <SelectItem value="true">True</SelectItem>
        <SelectItem value="false">False</SelectItem>
        {nullable && (
          <SelectItem value="null" className="text-muted-foreground italic">
            null
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
