import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Input, Button } from '@/components';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Debounce delay in milliseconds. Set to 0 to disable debouncing. Default: 500ms */
  debounceTime?: number;
  /** Callback fired immediately when input changes (before debounce) */
  onImmediateChange?: (value: string) => void;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  className,
  debounceTime = 500,
  onImmediateChange,
}: SearchInputProps) {
  const [internalValue, setInternalValue] = useState(value);

  // Sync internal value with external value prop
  useEffect(() => {
    setInternalValue(value);
  }, [value]);

  // Handle debounced onChange
  useEffect(() => {
    if (debounceTime === 0) {
      // No debouncing, call onChange immediately
      onChange(internalValue);
      return;
    }

    // Set up debounce timer
    const handler = setTimeout(() => {
      onChange(internalValue);
    }, debounceTime);

    // Cleanup timer on value change
    return () => {
      clearTimeout(handler);
    };
  }, [internalValue, debounceTime, onChange]);

  const handleInputChange = (newValue: string) => {
    setInternalValue(newValue);
    // Call immediate change callback if provided
    onImmediateChange?.(newValue);
  };

  const handleClear = () => {
    setInternalValue('');
    onImmediateChange?.('');
    // If no debouncing, clear immediately
    if (debounceTime === 0) {
      onChange('');
    }
  };

  return (
    <div
      className={`relative bg-white dark:bg-neutral-900 overflow-hidden rounded-md ${className || ''}`}
    >
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground dark:text-zinc-300" />
      <Input
        type="text"
        placeholder={placeholder}
        value={internalValue}
        onChange={(e) => handleInputChange(e.target.value)}
        className="pl-9 pr-9 h-10  dark:text-white dark:placeholder:text-neutral-400 dark:border-neutral-700"
      />
      {internalValue && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClear}
          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
