import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from './Button';
import { Input } from './Input';
import { cn } from '../lib';

export interface SearchInputProps {
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
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Sync internal value with external value prop.
  useEffect(() => {
    setInternalValue(value);
  }, [value]);

  // Handle debounced onChange.
  useEffect(() => {
    if (debounceTime === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onChangeRef.current(internalValue);
    }, debounceTime);

    return () => window.clearTimeout(timeoutId);
  }, [internalValue, debounceTime]);

  const handleInputChange = (nextValue: string) => {
    setInternalValue(nextValue);
    onImmediateChange?.(nextValue);
    if (debounceTime === 0) {
      onChangeRef.current(nextValue);
    }
  };

  const handleClear = () => {
    setInternalValue('');
    onImmediateChange?.('');
    if (debounceTime === 0) {
      onChangeRef.current('');
    }
  };

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        placeholder={placeholder}
        value={internalValue}
        onChange={(event) => handleInputChange(event.target.value)}
        className="h-8 pl-9 pr-9 text-[13px]"
      />
      {internalValue && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleClear}
          className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
        >
          <X />
        </Button>
      )}
    </div>
  );
}
