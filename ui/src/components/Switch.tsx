import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils';

const switchVariants = cva(
  [
    'peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-transparent transition-colors',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgb(var(--foreground))] focus-visible:ring-offset-1 focus-visible:ring-offset-[rgb(var(--inverse))]',
    'disabled:cursor-not-allowed disabled:opacity-40',
    'data-[state=checked]:bg-[rgb(var(--insforge-green-600))] data-[state=unchecked]:bg-[var(--alpha-16)]',
  ],
  {
    variants: {
      size: {
        default: 'h-7 w-12 border-[4px]',
        sm: 'h-5 w-9 border-2',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

const thumbVariants = cva(
  'pointer-events-none block rounded-full bg-white shadow-lg ring-0 transition-transform data-[state=unchecked]:translate-x-0',
  {
    variants: {
      size: {
        default: 'size-5 data-[state=checked]:translate-x-5',
        sm: 'size-4 data-[state=checked]:translate-x-4',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>,
    VariantProps<typeof switchVariants> {}

const Switch = React.forwardRef<React.ComponentRef<typeof SwitchPrimitives.Root>, SwitchProps>(
  ({ className, size, ...props }, ref) => (
    <SwitchPrimitives.Root className={cn(switchVariants({ size, className }))} {...props} ref={ref}>
      <SwitchPrimitives.Thumb className={cn(thumbVariants({ size }))} />
    </SwitchPrimitives.Root>
  )
);
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch, switchVariants };
