import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CheckCircle2, X } from 'lucide-react';

import { cn } from '../lib/utils';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    showCloseButton?: boolean;
  }
>(({ className, children, showCloseButton = true, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[640px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-[var(--alpha-8)] bg-[rgb(var(--semantic-1))] shadow-[0_8px_12px_rgba(0,0,0,0.24)] outline-none',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
        'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && <DialogCloseButton className="absolute right-3 top-3" />}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col items-start gap-1 border-b border-[var(--alpha-8)] px-4 py-3 text-left',
        className
      )}
      {...props}
    />
  )
);
DialogHeader.displayName = 'DialogHeader';

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-medium leading-7 text-foreground', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm leading-6 text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

const DialogBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-2 p-4', className)} {...props} />
  )
);
DialogBody.displayName = 'DialogBody';

const DialogDivider = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex h-5 items-center', className)} {...props}>
      <div className="h-px w-full bg-[var(--alpha-8)]" />
    </div>
  )
);
DialogDivider.displayName = 'DialogDivider';

const DialogFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-end gap-3 border-t border-[var(--alpha-8)] p-4',
        className
      )}
      {...props}
    />
  )
);
DialogFooter.displayName = 'DialogFooter';

interface DialogMessageProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
}

const DialogMessage = React.forwardRef<HTMLDivElement, DialogMessageProps>(
  ({ className, icon, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'mr-auto flex min-w-0 flex-1 items-center gap-1 text-sm leading-6 text-muted-foreground',
        className
      )}
      {...props}
    >
      {icon === null ? null : (icon ?? <CheckCircle2 className="size-4 shrink-0" />)}
      <span className="truncate">{children}</span>
    </div>
  )
);
DialogMessage.displayName = 'DialogMessage';

const DialogCloseButton = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Close
    ref={ref}
    className={cn(
      'inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors',
      'hover:bg-[var(--alpha-8)] hover:text-foreground',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgb(var(--foreground))] focus-visible:ring-offset-1 focus-visible:ring-offset-[rgb(var(--inverse))]',
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        <X className="size-5" />
        <span className="sr-only">Close</span>
      </>
    )}
  </DialogPrimitive.Close>
));
DialogCloseButton.displayName = 'DialogCloseButton';

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogDivider,
  DialogFooter,
  DialogMessage,
  DialogCloseButton,
};
