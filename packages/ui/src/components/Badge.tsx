import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib';

const badgeVariants = cva('inline-flex items-center justify-center font-medium text-xs leading-4', {
  variants: {
    variant: {
      default: 'bg-[var(--alpha-8)] text-muted-foreground px-2 py-0.5 rounded gap-1',
      rounded: 'bg-[var(--alpha-8)] text-muted-foreground px-2 py-0.5 rounded-full gap-1',
      number: 'bg-destructive text-white px-1.5 py-0.5 rounded-full min-w-4 text-center',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />;
  }
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
