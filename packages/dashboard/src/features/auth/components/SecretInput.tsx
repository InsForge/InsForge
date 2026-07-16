import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Input, cn } from '@insforge/ui';

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
  const { t } = useTranslation('chrome');
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
        aria-label={
          isVisible
            ? t('auth.hideClientSecret', { defaultValue: 'Hide client secret' })
            : t('auth.showClientSecret', { defaultValue: 'Show client secret' })
        }
      >
        {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
    </div>
  );
}
