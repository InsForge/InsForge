import { Eye, EyeOff } from 'lucide-react';
import { cn } from '#lib/utils/utils';

interface ShowPasswordButtonProps {
  show: boolean;
  onToggle: () => void;
  className?: string;
}

export function ShowPasswordButton({ show, onToggle, className }: ShowPasswordButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded bg-transparent px-0 text-xs font-normal leading-4 text-muted-foreground transition-colors hover:text-foreground',
        className
      )}
      aria-pressed={show}
      aria-label={`${show ? 'Hide' : 'Show'} password`}
    >
      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      <span>{show ? 'Hide' : 'Show'} Password</span>
    </button>
  );
}
