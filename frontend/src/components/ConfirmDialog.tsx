import * as React from 'react';
import { X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
  isLoading?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  destructive = false,
  isLoading = false,
}: ConfirmDialogProps) {
  const handleConfirm = async () => {
    await onConfirm();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[480px] p-0 gap-0 bg-white border border-zinc-200 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] dark:bg-neutral-800 dark:border-neutral-700 dark:text-white">
        {/* Header with close button */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-200 dark:border-neutral-700">
          <AlertDialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white">
            {title}
          </AlertDialogTitle>
          <button
            className="absolute right-6 top-6 rounded-sm text-zinc-500 transition-colors hover:text-zinc-700 focus:outline-none disabled:pointer-events-none dark:text-zinc-400 dark:hover:text-zinc-300"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        {/* Description */}
        <div className="p-6">
          {typeof description === 'string' ? (
            <AlertDialogDescription className="text-zinc-500 text-sm leading-5 dark:text-neutral-400">
              {description}
            </AlertDialogDescription>
          ) : (
            <div className="text-zinc-500 text-sm leading-5 dark:text-neutral-400">
              {description}
            </div>
          )}
        </div>

        {/* Footer */}
        <AlertDialogFooter className="p-6 flex-row justify-end gap-3 border-t border-zinc-200 dark:border-neutral-700">
          <AlertDialogCancel
            disabled={isLoading}
            className="h-10 w-30 px-3 py-2 text-sm font-medium bg-white border border-zinc-200 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] rounded-md hover:bg-zinc-50 dark:bg-neutral-600 dark:border-neutral-600 dark:text-white dark:hover:bg-neutral-700"
          >
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void handleConfirm();
            }}
            disabled={isLoading}
            className={`h-10 w-30 px-3 py-2 text-sm font-medium rounded-md shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] dark:shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] ${
              destructive
                ? 'bg-red-600 hover:bg-red-700 text-white dark:bg-red-200 dark:hover:bg-red-300 dark:text-red-700'
                : 'bg-zinc-950 hover:bg-zinc-900 text-white dark:bg-emerald-300 dark:text-black dark:hover:bg-emerald-400'
            }`}
          >
            {isLoading ? 'Processing...' : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
