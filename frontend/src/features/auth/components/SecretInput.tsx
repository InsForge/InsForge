import type { ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Input } from '@insforge/ui';
import { cn } from '@/lib/utils/utils';

const FIXED_MASK = '••••••••••••••';

interface SecretInputProps extends ComponentProps<typeof Input> {
  isVisible: boolean;
  onToggleVisibility: () => void;
}

export function SecretInput({
  isVisible,
  onToggleVisibility,
  className,
  value,
  ...props
}: SecretInputProps) {
  const hasValue = typeof value === 'string' ? value.length > 0 : Boolean(value);
  const showFixedMask = hasValue && !isVisible;

  return (
    <div className="relative">
      <Input
        type="text"
        value={value}
        className={cn(
          'pr-10',
          showFixedMask && 'text-transparent caret-foreground selection:bg-transparent',
          className
        )}
        {...props}
      />
      {showFixedMask && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center px-3 text-sm text-foreground"
        >
          {FIXED_MASK}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={onToggleVisibility}
        aria-label={isVisible ? 'Hide client secret' : 'Show client secret'}
      >
        {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
    </div>
  );
}
