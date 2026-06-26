import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@insforge/ui';

interface ListRowProps {
  children: ReactNode;
  /** Row click handler. When set, the card shows a pointer cursor. */
  onClick?: () => void;
  /** Overrides applied to the outer card. */
  className?: string;
  /** Overrides applied to the inner hover row (e.g. leading padding). */
  contentClassName?: string;
  /** Optional content rendered below the row, inside the card (e.g. an expanded panel). */
  footer?: ReactNode;
}

/**
 * The shared card-row shell used across feature list views: a bordered
 * `bg-card` container with an inner hover surface. Pair with `ListRowCell` for
 * the per-column cells. Centralizes the row design tokens so a design change
 * lands in one place.
 */
export function ListRow({ children, onClick, className, contentClassName, footer }: ListRowProps) {
  return (
    <div className={cn('group rounded border border-[var(--alpha-8)] bg-card', className)}>
      <div
        className={cn(
          'flex items-center rounded transition-colors hover:bg-[var(--alpha-8)]',
          onClick && 'cursor-pointer',
          contentClassName
        )}
        onClick={onClick}
      >
        {children}
      </div>
      {footer}
    </div>
  );
}

type ListRowCellProps = HTMLAttributes<HTMLDivElement>;

/**
 * A single fixed-height column within a `ListRow`. Sizing (`flex-1 min-w-0`,
 * `w-[60px] shrink-0`, alignment, etc.) is supplied via `className`.
 */
export function ListRowCell({ className, children, ...props }: ListRowCellProps) {
  return (
    <div className={cn('flex h-12 items-center px-2.5', className)} {...props}>
      {children}
    </div>
  );
}
