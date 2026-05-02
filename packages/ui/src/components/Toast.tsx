import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib';

const toastVariants = cva(
  'flex w-full max-w-[800px] px-2 py-2 items-center gap-2 rounded border border-[var(--alpha-8)] shadow-[0px_4px_4px_0px_rgba(0,0,0,0.08)]',
  {
    variants: {
      variant: {
        default: 'bg-toast',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface ToastProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof toastVariants> {
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  ({ className, variant, icon, action, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn(toastVariants({ variant }), className)} {...props}>
        <div className="flex flex-1 items-center gap-1 min-w-0 px-1">
          {icon && <span className="shrink-0 size-6 flex items-center justify-center">{icon}</span>}
          <span className="text-sm text-muted-foreground whitespace-nowrap truncate">
            {children}
          </span>
        </div>
        {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
      </div>
    );
  }
);
Toast.displayName = 'Toast';

export { Toast, toastVariants };
