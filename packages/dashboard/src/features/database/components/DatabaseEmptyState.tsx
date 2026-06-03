import { type ReactNode } from 'react';
import { EmptyStateIllustration } from '#components';
import { cn } from '#lib/utils/utils';

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
      {illustration ?? <EmptyStateIllustration />}
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
