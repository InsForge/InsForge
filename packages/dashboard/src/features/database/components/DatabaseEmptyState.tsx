import { CSSProperties, type ReactNode } from 'react';
import EmptyBoxSvg from '../../../assets/images/empty_box.svg?react';
import { cn } from '../../../lib/utils/utils';

interface DatabaseEmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  illustration?: ReactNode;
  className?: string;
}

export function DatabaseEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  illustration,
  className,
}: DatabaseEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-[198px] flex-col items-center justify-center gap-2 px-6 pb-12 pt-6 text-center',
        className
      )}
    >
      {illustration ?? (
        <EmptyBoxSvg
          className="h-[95px] w-[160px]"
          style={
            {
              '--empty-box-fill-primary': 'rgb(var(--semantic-2))',
              '--empty-box-fill-secondary': 'rgb(var(--semantic-6))',
            } as CSSProperties
          }
          aria-hidden="true"
        />
      )}
      <p className="text-sm font-medium leading-6 text-muted-foreground">{title}</p>
      {description && <p className="text-xs leading-4 text-muted-foreground">{description}</p>}
      {actionLabel && onAction && (
        <button
          type="button"
          className="text-xs leading-4 text-primary transition-opacity hover:opacity-90"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
