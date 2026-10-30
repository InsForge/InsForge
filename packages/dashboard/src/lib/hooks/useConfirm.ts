import { useRef, useState } from 'react';

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
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const pendingPromiseRef = useRef<Promise<boolean> | null>(null);

  const confirm = (confirmOptions: ConfirmOptions): Promise<boolean> => {
    resolveRef.current?.(false);

    setOptions(confirmOptions);
    setIsOpen(true);

    const promise = new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
    pendingPromiseRef.current = promise;
    return promise;
  };

  const settle = (value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    pendingPromiseRef.current = null;
    setIsOpen(false);
  };

  const handleConfirm = () => settle(true);
  const handleCancel = () => settle(false);

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
