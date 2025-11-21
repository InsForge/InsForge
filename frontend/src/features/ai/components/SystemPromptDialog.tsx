import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Label,
  Textarea,
} from '@/components';
import {
  UpdateAIConfigurationRequest,
  updateAIConfigurationRequestSchema,
} from '@insforge/shared-schemas';

interface SystemPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSystemPrompt: string | null | undefined;
  onSuccess: (data: UpdateAIConfigurationRequest) => void;
}

export function SystemPromptDialog({
  open,
  onOpenChange,
  initialSystemPrompt,
  onSuccess,
}: SystemPromptDialogProps) {
  const form = useForm<UpdateAIConfigurationRequest>({
    resolver: zodResolver(updateAIConfigurationRequestSchema),
    defaultValues: {
      systemPrompt: initialSystemPrompt ?? null,
    },
  });

  // Reset form when dialog opens with new data
  useEffect(() => {
    if (open) {
      form.reset({
        systemPrompt: initialSystemPrompt ?? null,
      });
    }
  }, [open, initialSystemPrompt, form]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit((data: UpdateAIConfigurationRequest) => {
      onSuccess(data);
      onOpenChange(false);
    })();
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-[600px] p-0 gap-0 border-zinc-200 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)]"
      >
        <DialogHeader className="px-6 py-3 flex flex-col gap-1 justify-start border-b border-zinc-200 dark:border-neutral-700">
          <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white">
            Edit System Prompt
          </DialogTitle>
        </DialogHeader>

        <form id="system-prompt-form" onSubmit={handleFormSubmit} className="flex flex-col">
          <div className="flex flex-col gap-6 p-6">
            <div className="flex flex-row gap-10 items-start">
              <Label
                htmlFor="systemPrompt"
                className="text-sm font-normal text-zinc-950 dark:text-neutral-50 whitespace-nowrap"
              >
                System Prompt
              </Label>
              <div className="flex flex-col gap-1 w-full">
                <Textarea
                  id="systemPrompt"
                  {...form.register('systemPrompt')}
                  placeholder="Enter system prompt..."
                  className="w-full min-h-[160px] resize-none bg-transparent dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-400 dark:border-neutral-700 focus:outline-none"
                />
                {form.formState.errors.systemPrompt && (
                  <p className="text-sm text-red-600 dark:text-red-500">
                    {form.formState.errors.systemPrompt.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        </form>

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
            form="system-prompt-form"
            className="h-9 px-3 py-2 rounded-sm text-sm font-medium bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
