import type { ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Input } from '@insforge/ui';
import { cn } from '#lib/utils/utils';

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
  return (
    <div className="relative">
      <Input
        type={isVisible ? 'text' : 'password'}
        value={value}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn('pr-10', className)}
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={onToggleVisibility}
        aria-pressed={isVisible}
        aria-label={isVisible ? 'Hide client secret' : 'Show client secret'}
      >
        {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
    </div>
  );
}
