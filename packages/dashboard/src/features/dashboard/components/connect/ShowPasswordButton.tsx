import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@insforge/ui';
import { useTranslation } from 'react-i18next';

interface ShowPasswordButtonProps {
  show: boolean;
  onToggle: () => void;
  className?: string;
}

export function ShowPasswordButton({ show, onToggle, className }: ShowPasswordButtonProps) {
  const { t } = useTranslation('chrome');
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded bg-transparent px-0 text-xs font-normal leading-4 text-muted-foreground transition-colors hover:text-foreground',
        className
      )}
      aria-pressed={show}
      aria-label={
        show
          ? t('overview.hidePassword', { defaultValue: 'Hide Password' })
          : t('overview.showPassword', { defaultValue: 'Show Password' })
      }
    >
      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      <span>
        {show
          ? t('overview.hidePassword', { defaultValue: 'Hide Password' })
          : t('overview.showPassword', { defaultValue: 'Show Password' })}
      </span>
    </button>
  );
}
