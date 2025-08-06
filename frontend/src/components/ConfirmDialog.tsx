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

interface confirmDialogProps {
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
}: confirmDialogProps) {
  const handleConfirm = async () => {
    await onConfirm();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[400px] py-6 px-0 gap-6 bg-white border border-zinc-200 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)]">
        {/* Header with close button */}
        <div className="flex items-center justify-between px-6">
          <AlertDialogTitle className="text-base font-semibold text-zinc-950">
            {title}
          </AlertDialogTitle>
          <button
            className="absolute right-6 top-6 rounded-sm text-zinc-500 transition-colors hover:text-zinc-700 focus:outline-none disabled:pointer-events-none"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        {/* Description */}
        <div className="px-6">
          {typeof description === 'string' ? (
            <AlertDialogDescription className="text-zinc-500 text-sm leading-5">
              {description}
            </AlertDialogDescription>
          ) : (
            <div className="text-zinc-500 text-sm leading-5">{description}</div>
          )}
        </div>

        {/* Footer */}
        <AlertDialogFooter className="px-6 flex-row justify-end gap-3">
          <AlertDialogCancel
            disabled={isLoading}
            className="h-10 w-20 px-4 py-2 text-sm font-medium bg-white border border-zinc-200 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] rounded-md hover:bg-zinc-50"
          >
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void handleConfirm();
            }}
            disabled={isLoading}
            className={`h-10 w-20 px-4 py-2 text-sm font-medium rounded-md shadow-[0px_1px_2px_0px_rgba(0,0,0,0.1)] ${
              destructive
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-zinc-950 hover:bg-zinc-900 text-white'
            }`}
          >
            {isLoading ? 'Processing...' : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
