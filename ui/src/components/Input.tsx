import * as React from 'react';
import { cn } from '../lib';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex w-full rounded-lg bg-[var(--alpha-4)] border border-[var(--alpha-12)]',
          'py-2 px-3 text-sm leading-5 text-foreground transition-colors',
          'placeholder:text-muted-foreground/50',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
          'hover:bg-[var(--alpha-8)]',
          'outline-none focus:outline-none focus:shadow-none focus:border-foreground/30',
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
