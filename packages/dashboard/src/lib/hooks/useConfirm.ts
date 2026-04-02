import { useState } from 'react';

interface ConfirmOptions {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

export function useConfirm() {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({
    title: '',
    description: '',
  });
  const [resolvePromise, setResolvePromise] = useState<((value: boolean) => void) | null>(null);

  const confirm = (confirmOptions: ConfirmOptions): Promise<boolean> => {
    setOptions(confirmOptions);
    setIsOpen(true);

    return new Promise<boolean>((resolve) => {
      setResolvePromise(() => resolve);
    });
  };

  const handleConfirm = () => {
    resolvePromise?.(true);
    setIsOpen(false);
  };

  const handleCancel = () => {
    resolvePromise?.(false);
    setIsOpen(false);
  };

  return {
    confirm,
    confirmDialogProps: {
      open: isOpen,
      onOpenChange: (open: boolean) => {
        if (!open) {
          handleCancel();
        }
      },
      title: options.title,
      description: options.description,
      confirmText: options.confirmText,
      cancelText: options.cancelText,
      destructive: options.destructive,
      onConfirm: handleConfirm,
    },
  };
}
