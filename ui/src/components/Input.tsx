import * as React from 'react';
import { cn } from '../lib';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex w-full rounded bg-[var(--alpha-4)] border border-[var(--alpha-12)]',
          'p-1.5 text-sm leading-5 text-foreground transition-colors',
          'placeholder:text-muted-foreground',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
          'hover:bg-[var(--alpha-8)]',
          'focus:outline-none focus:shadow-[0_0_0_1px_rgb(var(--inverse)),0_0_0_2px_rgb(var(--foreground))]',
          'disabled:cursor-not-allowed disabled:text-[rgb(var(--disabled))] disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
