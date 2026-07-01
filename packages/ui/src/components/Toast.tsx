import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib';

const DEFAULT_TOAST_DURATION = 3000;
const SUCCESS_TOAST_DURATION = 2000;
const PERSISTENT_TOAST_DURATION = 24 * 60 * 60 * 1000;

export type ToastVariant = 'success' | 'error' | 'info' | 'warning' | 'warn';

type ToastTone = 'success' | 'error' | 'info' | 'warn' | 'upload';

export interface ToastOptions {
  variant?: ToastVariant;
  icon?: React.ReactNode;
  duration?: number;
}

export interface ToastUpdateOptions extends ToastOptions {
  message?: string;
  progress?: number;
  onCancel?: () => void;
}

export interface UploadToastOptions {
  onCancel?: () => void;
}

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

interface ToastRecord {
  id: string;
  message: string;
  tone: ToastTone;
  icon?: React.ReactNode;
  duration: number;
  progress?: number;
  onCancel?: () => void;
}

interface ToastContextValue {
  toast: ToastFunction;
  showToast: ToastFunction;
  updateToast: (id: string, updates: ToastUpdateOptions) => void;
  dismissToast: (id: string) => void;
  removeToast: (id: string) => void;
}

interface ToastFunction {
  (
    message: string,
    options?: ToastOptions | ToastVariant,
    icon?: React.ReactNode,
    duration?: number
  ): string;
  success: (message: string, options?: Omit<ToastOptions, 'variant'>) => string;
  error: (message: string, options?: Omit<ToastOptions, 'variant'>) => string;
  info: (message: string, options?: Omit<ToastOptions, 'variant'>) => string;
  warning: (message: string, options?: Omit<ToastOptions, 'variant'>) => string;
  upload: (message: string, options?: Omit<ToastUpdateOptions, 'message' | 'variant'>) => string;
}

interface ToastItemProps {
  toast: ToastRecord;
  onRemove: () => void;
}

const ToastContext = React.createContext<ToastContextValue | undefined>(undefined);

function normalizeTone(variant?: ToastVariant): ToastTone {
  if (variant === 'warning') {
    return 'warn';
  }

  return variant ?? 'info';
}

function getToastDuration(tone: ToastTone, duration?: number) {
  if (duration !== undefined) {
    return duration;
  }

  return tone === 'success' ? SUCCESS_TOAST_DURATION : DEFAULT_TOAST_DURATION;
}

function clampProgress(progress?: number) {
  const finiteProgress = progress !== undefined && Number.isFinite(progress) ? progress : 0;

  return Math.min(100, Math.max(0, finiteProgress));
}

function createToastId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeToastOptions(
  options?: ToastOptions | ToastVariant,
  icon?: React.ReactNode,
  duration?: number
): Required<Pick<ToastOptions, 'variant'>> & Omit<ToastOptions, 'variant'> {
  if (typeof options === 'string') {
    return { variant: options, icon, duration };
  }

  return {
    variant: options?.variant ?? 'info',
    icon: options?.icon ?? icon,
    duration: options?.duration ?? duration,
  };
}

function getDefaultIcon(tone: ToastTone) {
  switch (tone) {
    case 'success':
      return (
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'error':
      return (
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      );
    case 'warn':
      return (
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
      );
    case 'upload':
      return (
        <svg
          className="h-5 w-5 shrink-0 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      );
    case 'info':
      return (
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
  }
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const typeClasses: Record<ToastTone, string> = {
    success: 'bg-green-300 text-green-700 border-green-400',
    error: 'bg-red-300 text-red-700 border-red-400',
    info: 'bg-blue-300 text-blue-700 border-blue-400',
    warn: 'bg-yellow-300 text-yellow-700 border-yellow-400',
    upload: 'bg-neutral-100 text-zinc-950 border-neutral-800',
  };

  const progressBarClasses: Record<ToastTone, string> = {
    success: 'bg-green-700',
    error: 'bg-red-700',
    info: 'bg-blue-700',
    warn: 'bg-yellow-700',
    upload: 'bg-neutral-700',
  };

  const duration = toast.tone === 'upload' ? PERSISTENT_TOAST_DURATION : toast.duration;

  return (
    <ToastPrimitive.Root
      duration={duration}
      onOpenChange={(open) => {
        if (!open) {
          onRemove();
        }
      }}
      className={cn(
        'relative flex items-center overflow-hidden rounded-[8px] border-1 p-3 font-medium',
        'data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:duration-300',
        'data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x)',
        'data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform data-[swipe=cancel]:duration-200',
        'data-[swipe=end]:animate-out data-[swipe=end]:fade-out data-[swipe=end]:slide-out-to-right-full',
        typeClasses[toast.tone]
      )}
    >
      <div className="flex flex-1 items-center gap-2">
        {toast.icon ?? getDefaultIcon(toast.tone)}
        <ToastPrimitive.Description asChild>
          <span className="flex-1 text-sm font-medium">{toast.message}</span>
        </ToastPrimitive.Description>
        {toast.tone === 'upload' && toast.onCancel && (
          <ToastPrimitive.Action asChild altText="Cancel upload">
            <button
              type="button"
              onClick={toast.onCancel}
              className="text-sm font-medium text-zinc-500 hover:text-zinc-700"
            >
              Cancel
            </button>
          </ToastPrimitive.Action>
        )}
      </div>

      {toast.tone === 'upload' ? (
        <div className="absolute bottom-0 left-0 h-1 w-full overflow-hidden bg-neutral-300">
          <div
            className={cn(
              'h-full transition-all duration-300 ease-out',
              progressBarClasses[toast.tone]
            )}
            style={{ width: `${clampProgress(toast.progress)}%` }}
          />
        </div>
      ) : (
        <div className="absolute bottom-0 left-0 h-1 w-full overflow-hidden bg-transparent">
          <div
            className={cn(
              'h-full w-full origin-left animate-toast-progress',
              progressBarClasses[toast.tone]
            )}
            style={{ animationDuration: `${toast.duration}ms` }}
          />
        </div>
      )}
    </ToastPrimitive.Root>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const updateToast = React.useCallback((id: string, updates: ToastUpdateOptions) => {
    setToasts((prev) =>
      prev.map((toast) => {
        if (toast.id !== id) {
          return toast;
        }

        const tone = updates.variant ? normalizeTone(updates.variant) : toast.tone;
        // A variant change re-applies that tone's default duration unless an
        // explicit duration is passed; non-variant updates keep the prior timing.
        const durationOverride = updates.duration ?? (updates.variant ? undefined : toast.duration);

        return {
          ...toast,
          message: updates.message ?? toast.message,
          tone,
          icon: updates.icon ?? toast.icon,
          duration: getToastDuration(tone, durationOverride),
          progress:
            updates.progress === undefined ? toast.progress : clampProgress(updates.progress),
          onCancel: updates.onCancel ?? toast.onCancel,
        };
      })
    );
  }, []);

  const addToast = React.useCallback(
    (
      message: string,
      options?: ToastOptions | ToastVariant,
      icon?: React.ReactNode,
      duration?: number
    ) => {
      const normalizedOptions = normalizeToastOptions(options, icon, duration);
      const tone = normalizeTone(normalizedOptions.variant);
      const id = createToastId();

      setToasts((prev) => [
        ...prev,
        {
          id,
          message,
          tone,
          icon: normalizedOptions.icon,
          duration: getToastDuration(tone, normalizedOptions.duration),
        },
      ]);

      return id;
    },
    []
  );

  const toast = React.useMemo<ToastFunction>(() => {
    return Object.assign(addToast, {
      success: (message: string, options?: Omit<ToastOptions, 'variant'>) =>
        addToast(message, { ...options, variant: 'success' }),
      error: (message: string, options?: Omit<ToastOptions, 'variant'>) =>
        addToast(message, { ...options, variant: 'error' }),
      info: (message: string, options?: Omit<ToastOptions, 'variant'>) =>
        addToast(message, { ...options, variant: 'info' }),
      warning: (message: string, options?: Omit<ToastOptions, 'variant'>) =>
        addToast(message, { ...options, variant: 'warning' }),
      upload: (message: string, options?: Omit<ToastUpdateOptions, 'message' | 'variant'>) => {
        const id = createToastId();

        setToasts((prev) => [
          ...prev,
          {
            id,
            message,
            tone: 'upload',
            icon: options?.icon,
            duration: PERSISTENT_TOAST_DURATION,
            progress: clampProgress(options?.progress),
            onCancel: options?.onCancel,
          },
        ]);

        return id;
      },
    });
  }, [addToast]);

  const regularToasts = toasts.filter((toastItem) => toastItem.tone !== 'upload');
  const uploadToasts = toasts.filter((toastItem) => toastItem.tone === 'upload');

  const contextValue = React.useMemo<ToastContextValue>(
    () => ({ toast, showToast: toast, updateToast, dismissToast, removeToast: dismissToast }),
    [toast, updateToast, dismissToast]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastPrimitive.Provider swipeDirection="right">
        {regularToasts.map((toastItem) => (
          <ToastItem
            key={toastItem.id}
            toast={toastItem}
            onRemove={() => dismissToast(toastItem.id)}
          />
        ))}
        <ToastPrimitive.Viewport className="fixed top-2 left-1/2 z-[9999] flex w-full max-w-[480px] -translate-x-1/2 transform flex-col gap-3" />
      </ToastPrimitive.Provider>
      <ToastPrimitive.Provider swipeDirection="right">
        {uploadToasts.map((toastItem) => (
          <ToastItem
            key={toastItem.id}
            toast={toastItem}
            onRemove={() => dismissToast(toastItem.id)}
          />
        ))}
        <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-[9999] flex w-[276px] flex-col" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }

  return context;
}

export function useUploadToast() {
  const { toast, updateToast, dismissToast } = useToast();

  const showUploadToast = React.useCallback(
    (fileCount: number, options?: UploadToastOptions) => {
      const message = `${fileCount} file${fileCount > 1 ? 's' : ''} uploading`;
      const toastId = toast.upload(message, {
        progress: 0,
        onCancel: () => {
          options?.onCancel?.();
          dismissToast(toastId);
        },
      });

      return toastId;
    },
    [dismissToast, toast]
  );

  const updateUploadProgress = React.useCallback(
    (toastId: string, progress: number) => {
      const clampedProgress = clampProgress(progress);

      updateToast(toastId, { progress: clampedProgress });

      if (clampedProgress >= 100) {
        window.setTimeout(() => {
          dismissToast(toastId);
        }, 1500);
      }
    },
    [dismissToast, updateToast]
  );

  const cancelUpload = React.useCallback(
    (toastId: string) => {
      dismissToast(toastId);
    },
    [dismissToast]
  );

  return {
    showUploadToast,
    updateUploadProgress,
    cancelUpload,
  };
}

const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  ({ className, variant, icon, action, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn(toastVariants({ variant }), className)} {...props}>
        <div className="flex min-w-0 flex-1 items-center gap-1 px-1">
          {icon && <span className="flex size-6 shrink-0 items-center justify-center">{icon}</span>}
          <span className="truncate whitespace-nowrap text-sm text-muted-foreground">
            {children}
          </span>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    );
  }
);
Toast.displayName = 'Toast';

const ToastRoot = ToastPrimitive.Root;
const ToastAction = ToastPrimitive.Action;
const ToastClose = ToastPrimitive.Close;
const ToastDescription = ToastPrimitive.Description;
const ToastTitle = ToastPrimitive.Title;
const ToastViewport = ToastPrimitive.Viewport;

export {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRoot,
  ToastTitle,
  ToastViewport,
  toastVariants,
};
