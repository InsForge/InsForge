import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '../lib/utils';

const MenuDialog = DialogPrimitive.Root;

const MenuDialogTrigger = DialogPrimitive.Trigger;

const MenuDialogPortal = DialogPrimitive.Portal;

const MenuDialogClose = DialogPrimitive.Close;

const MenuDialogOverlay = React.forwardRef<
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
MenuDialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const MenuDialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <MenuDialogPortal>
    <MenuDialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 flex h-[min(640px,calc(100vh-2rem))] w-[calc(100%-1.5rem)] max-w-[840px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-[var(--alpha-8)] bg-[rgb(var(--semantic-1))] shadow-[0_8px_12px_rgba(0,0,0,0.24)] outline-none',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
        'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </MenuDialogPortal>
));
MenuDialogContent.displayName = DialogPrimitive.Content.displayName;

const MenuDialogSideNav = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex h-full w-[200px] shrink-0 flex-col border-r border-[var(--alpha-8)] bg-[rgb(var(--semantic-2))]',
        className
      )}
      {...props}
    />
  )
);
MenuDialogSideNav.displayName = 'MenuDialogSideNav';

const MenuDialogSideNavHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center gap-3 px-4 py-3', className)} {...props} />
));
MenuDialogSideNavHeader.displayName = 'MenuDialogSideNavHeader';

const MenuDialogSideNavTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn('text-base font-medium leading-7 text-foreground', className)}
    {...props}
  />
));
MenuDialogSideNavTitle.displayName = 'MenuDialogSideNavTitle';

const MenuDialogNav = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex min-h-0 flex-1 flex-col gap-3 px-3 pb-2', className)}
      {...props}
    />
  )
);
MenuDialogNav.displayName = 'MenuDialogNav';

const MenuDialogNavList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1.5', className)} {...props} />
  )
);
MenuDialogNavList.displayName = 'MenuDialogNavList';

interface MenuDialogNavItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: React.ReactNode;
}

const MenuDialogNavItem = React.forwardRef<HTMLButtonElement, MenuDialogNavItemProps>(
  ({ className, active = false, icon, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'flex w-full items-center gap-1 rounded p-1.5 text-sm leading-5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgb(var(--foreground))] focus-visible:ring-offset-1 focus-visible:ring-offset-[rgb(var(--inverse))]',
        'disabled:pointer-events-none disabled:opacity-40',
        active
          ? 'bg-[rgb(var(--toast))] text-foreground'
          : 'text-muted-foreground hover:bg-[var(--alpha-4)] hover:text-foreground',
        className
      )}
      {...props}
    >
      {icon && <span className="flex h-6 w-6 shrink-0 items-center justify-center">{icon}</span>}
      <span className="truncate px-2 text-left">{children}</span>
    </button>
  )
);
MenuDialogNavItem.displayName = 'MenuDialogNavItem';

const MenuDialogMain = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex min-w-0 flex-1 flex-col bg-[rgb(var(--semantic-1))]', className)}
      {...props}
    />
  )
);
MenuDialogMain.displayName = 'MenuDialogMain';

const MenuDialogHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-3 border-b border-[var(--alpha-8)] px-4 py-3',
        className
      )}
      {...props}
    />
  )
);
MenuDialogHeader.displayName = 'MenuDialogHeader';

const MenuDialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-medium leading-7 text-foreground', className)}
    {...props}
  />
));
MenuDialogTitle.displayName = DialogPrimitive.Title.displayName;

const MenuDialogBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto border-b border-[var(--alpha-8)] p-4',
        className
      )}
      {...props}
    />
  )
);
MenuDialogBody.displayName = 'MenuDialogBody';

const MenuDialogFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center justify-end gap-3 p-4', className)}
      {...props}
    />
  )
);
MenuDialogFooter.displayName = 'MenuDialogFooter';

const MenuDialogCloseButton = React.forwardRef<
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
MenuDialogCloseButton.displayName = 'MenuDialogCloseButton';

export {
  MenuDialog,
  MenuDialogTrigger,
  MenuDialogPortal,
  MenuDialogClose,
  MenuDialogOverlay,
  MenuDialogContent,
  MenuDialogSideNav,
  MenuDialogSideNavHeader,
  MenuDialogSideNavTitle,
  MenuDialogNav,
  MenuDialogNavList,
  MenuDialogNavItem,
  MenuDialogMain,
  MenuDialogHeader,
  MenuDialogTitle,
  MenuDialogBody,
  MenuDialogFooter,
  MenuDialogCloseButton,
};
