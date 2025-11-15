import React, { createContext, useContext, useState, useCallback } from 'react';
import { useTimeout } from './useTimeout';
import { cn, generateUUID } from '@/lib/utils/utils';

interface Toast {
  id: string;
  message: string;
  type?: 'success' | 'error' | 'info' | 'warn' | 'upload';
  customIcon?: React.ReactNode;
  duration: number;
  progress?: number;
  onCancel?: () => void;
}

interface ToastContextType {
  showToast: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warn' | 'upload',
    customIcon?: React.ReactNode,
    duration?: number
  ) => string;
  updateToast: (id: string, updates: Partial<Toast>) => void;
  removeToast: (id: string) => void;
}

const DEFAULT_TOAST_DURATION = 3000; // 3 seconds

const ToastContext = createContext<ToastContextType | undefined>(undefined);

interface ToastItemProps {
  toast: Toast;
  onRemove: () => void;
  getDefaultIcon: (type: string) => React.ReactNode;
}

function ToastItem({ toast, onRemove, getDefaultIcon }: ToastItemProps) {
  // Auto remove after duration (except for upload toasts)
  useTimeout(onRemove, toast.type === 'upload' ? null : toast.duration);

  const baseClasses =
    'relative p-3 rounded-[8px] font-medium animate-in fade-in duration-300 flex items-center overflow-hidden border-1';

  const typeClasses = {
    success: 'bg-green-300 text-green-700 border-green-400',
    error: 'bg-red-300 text-red-700 border-red-400',
    info: 'bg-blue-300 text-blue-700 border-blue-400',
    warn: 'bg-yellow-300 text-yellow-700 border-yellow-400',
    upload: 'bg-neutral-100 text-zinc-950 border-neutral-800',
  };

  const progressBarClasses = {
    success: 'bg-green-700',
    error: 'bg-red-700',
    info: 'bg-blue-700',
    warn: 'bg-yellow-700',
    upload: 'bg-neutral-700',
  };

  const toastType = toast.type || 'info';

  return (
    <div className={`${baseClasses} ${typeClasses[toastType]}`}>
      <div className="flex items-center gap-2 flex-1">
        {toast.customIcon || getDefaultIcon(toastType)}
        <span className="flex-1 text-sm font-medium">{toast.message}</span>
        {toast.type === 'upload' && toast.onCancel && (
          <button
            onClick={toast.onCancel}
            className="text-zinc-500 hover:text-zinc-700 text-sm font-medium"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Progress bar */}
      {toast.type === 'upload' ? (
        <div className="absolute bottom-0 left-0 w-full h-1 bg-neutral-300 overflow-hidden">
          <div
            className={`h-full ${progressBarClasses[toastType]} transition-all duration-300 ease-out`}
            style={{
              width: `${toast.progress || 0}%`,
            }}
          />
        </div>
      ) : (
        <div className="absolute bottom-0 left-0 w-full h-1 bg-transparent overflow-hidden">
          <div
            className={`h-full w-full ${progressBarClasses[toastType]} animate-toast-progress origin-left`}
            style={{
              animationDuration: `${toast.duration}ms`,
            }}
          />
        </div>
      )}
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback(
    (
      message: string,
      type: 'success' | 'error' | 'info' | 'warn' | 'upload' = 'info',
      customIcon?: React.ReactNode,
      duration: number = DEFAULT_TOAST_DURATION
    ) => {
      const id = generateUUID();
      // Set duration to 2 seconds for success toasts
      const toastDuration = type === 'success' ? 2000 : duration;
      const newToast: Toast = { id, message, type, customIcon, duration: toastDuration };

      setToasts((prev) => [...prev, newToast]);
      return id;
    },
    []
  );

  const updateToast = useCallback((id: string, updates: Partial<Toast>) => {
    setToasts((prev) => prev.map((toast) => (toast.id === id ? { ...toast, ...updates } : toast)));
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const getDefaultIcon = (type: string) => {
    switch (type) {
      case 'success':
        return (
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            className="w-5 h-5 shrink-0 animate-spin"
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
      default:
        return (
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        );
    }
  };

  return (
    <ToastContext.Provider value={{ showToast, updateToast, removeToast }}>
      {children}
      {/* Regular toasts - top center */}
      <div
        className={cn(
          'fixed top-2 left-1/2 transform -translate-x-1/2 z-[9999] flex flex-col gap-3 w-full max-w-[480px]'
        )}
      >
        {toasts
          .filter((t) => t.type !== 'upload')
          .map((toast) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onRemove={() => removeToast(toast.id)}
              getDefaultIcon={getDefaultIcon}
            />
          ))}
      </div>
      {/* Upload toasts - bottom right */}
      <div className="fixed bottom-4 right-4 z-[9999] w-[276px] flex flex-col">
        {toasts
          .filter((t) => t.type === 'upload')
          .map((toast) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onRemove={() => removeToast(toast.id)}
              getDefaultIcon={getDefaultIcon}
            />
          ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
