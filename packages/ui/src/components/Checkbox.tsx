import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';

import { cn } from '../lib/utils';

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'size-5 shrink-0 rounded-sm bg-[rgb(var(--semantic-4))] border border-[var(--alpha-8)]',
      'hover:border-[var(--alpha-16)]',
      'focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_rgb(var(--inverse)),0_0_0_2px_rgb(var(--foreground))]',
      'disabled:cursor-not-allowed disabled:opacity-40',
      'data-[state=checked]:bg-[rgb(var(--primary))] data-[state=checked]:border-transparent',
      'data-[state=indeterminate]:bg-[rgb(var(--primary))] data-[state=indeterminate]:border-transparent',
      'data-[state=checked]:disabled:bg-[rgb(var(--disabled))]',
      'data-[state=indeterminate]:disabled:bg-[rgb(var(--disabled))]',
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-[rgb(var(--inverse))]">
      {props.checked === 'indeterminate' ? (
        <Minus className="size-4" />
      ) : (
        <Check className="size-4" />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
