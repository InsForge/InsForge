import React, { useCallback, useState } from 'react';
import type { TextCellEditorProps } from './types';
import { cn } from '@/lib/utils/utils';

export function TextCellEditor({ value, onValueChange, onCancel, className }: TextCellEditorProps) {
  const [inputValue, setInputValue] = useState(String(value || ''));

  const handleSave = useCallback(() => {
    onValueChange(inputValue);
  }, [inputValue, onValueChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [handleSave, onCancel]
  );

  return (
    <input
      value={inputValue}
      onChange={(e) => setInputValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleSave}
      className={cn(
        'w-full border-none outline-none bg-white dark:bg-neutral-800 focus:border-0! focus:ring-0! focus:ring-offset-0! focus:outline-none!',
        className
      )}
      autoFocus
    />
  );
}
