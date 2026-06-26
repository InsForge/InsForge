import emptyStateUrl from '#assets/images/empty_state.png';
import { cn } from '@insforge/ui';

interface EmptyStateIllustrationProps {
  className?: string;
}

export function EmptyStateIllustration({ className }: EmptyStateIllustrationProps) {
  return (
    <img
      src={emptyStateUrl}
      alt=""
      className={cn('h-16 w-[72px] shrink-0', className)}
      aria-hidden="true"
    />
  );
}
