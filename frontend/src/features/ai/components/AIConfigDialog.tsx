import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/radix/Dialog';
import { Button } from '@/components/radix/Button';
import {
  AIConfigurationWithUsageSchema,
  CreateAIConfigurationRequest,
  UpdateAIConfigurationRequest,
} from '@insforge/shared-schemas';
import { AIConfigForm } from './AIConfigForm';

interface AIConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  editingConfig?: AIConfigurationWithUsageSchema;
  onSuccess?: (config: CreateAIConfigurationRequest | UpdateAIConfigurationRequest) => void;
}

export function AIConfigDialog({
  open,
  onOpenChange,
  mode,
  editingConfig,
  onSuccess,
}: AIConfigDialogProps) {
  const handleFormSubmit = (data: CreateAIConfigurationRequest | UpdateAIConfigurationRequest) => {
    onSuccess?.(data);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] p-0 border-zinc-200 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)]">
        <div className="flex flex-col">
          <DialogHeader className="px-6 py-3 flex flex-col gap-1 justify-start border-b border-zinc-200 dark:border-neutral-700">
            <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white">
              {mode === 'create' ? 'New AI Integration' : 'Edit System Prompt'}
            </DialogTitle>
          </DialogHeader>

          <AIConfigForm mode={mode} editingConfig={editingConfig} onSubmit={handleFormSubmit} />

          <DialogFooter className="p-6 gap-3 border-t border-zinc-200 dark:border-neutral-700">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              className="h-9 px-3 py-2 rounded-sm text-sm font-medium dark:bg-neutral-600 dark:text-zinc-300 dark:border-neutral-600 dark:hover:bg-neutral-700"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="ai-config-form"
              className="h-9 px-3 py-2 rounded-sm text-sm font-medium bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              {mode === 'create' ? 'Add Integration' : 'Save'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
