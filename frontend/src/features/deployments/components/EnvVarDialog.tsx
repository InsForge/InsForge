import { useState, useEffect } from 'react';
import { Button, Input, Dialog, DialogContent } from '@/components';
import type { DeploymentEnvVar } from '@insforge/shared-schemas';

interface EnvVarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  envVar?: DeploymentEnvVar | null;
  onSave: (key: string, value: string) => Promise<boolean>;
  isSaving?: boolean;
}

export function EnvVarDialog({
  open,
  onOpenChange,
  envVar,
  onSave,
  isSaving = false,
}: EnvVarDialogProps) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  const isEditMode = !!envVar;
  const title = isEditMode ? 'Edit Environment Variable' : 'Add New Environment Variable';
  const submitLabel = isEditMode ? 'Save' : 'Add';

  // Reset form when dialog opens/closes or envVar changes
  // In edit mode, value starts empty for security - user must enter new value
  useEffect(() => {
    if (open) {
      setKey(envVar?.key ?? '');
      setValue('');
    }
  }, [open, envVar]);

  const handleSubmit = async () => {
    const success = await onSave(key, value);
    if (success) {
      setKey('');
      setValue('');
      onOpenChange(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const isValid = key.trim() && value.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-200 dark:border-neutral-700">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white leading-7">{title}</h2>
        </div>

        {/* Form */}
        <div className="flex flex-col gap-6 p-6">
          {/* Key Field */}
          <div className="flex items-center gap-2">
            <label className="w-[120px] shrink-0 text-sm text-zinc-950 dark:text-neutral-50">
              Key
            </label>
            <Input
              placeholder="e.g CLIENT KEY"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="flex-1 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-400 dark:border-neutral-700"
            />
          </div>

          {/* Value Field */}
          <div className="flex items-center gap-2">
            <label className="w-[120px] shrink-0 text-sm text-zinc-950 dark:text-neutral-50">
              Value
            </label>
            <Input
              placeholder="Enter Value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1 dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-400 dark:border-neutral-700"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-neutral-200 dark:border-neutral-700">
          <Button
            variant="secondary"
            onClick={handleClose}
            className="flex-1 h-9 bg-neutral-200 dark:bg-neutral-600 hover:bg-neutral-300 dark:hover:bg-neutral-500 text-zinc-950 dark:text-white"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!isValid || isSaving}
            className="flex-1 h-9 bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            {isSaving ? 'Saving...' : submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
