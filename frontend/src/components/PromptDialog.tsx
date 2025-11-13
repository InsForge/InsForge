import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/radix/Dialog';
import { CopyButton } from '@/components/CopyButton';
import { cn } from '@/lib/utils/utils';

interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  subtitle?: string;
  prompt: string;
  additionalAction?: React.ReactNode;
}

export function PromptDialog({
  open,
  onOpenChange,
  title = 'Integrate with your application',
  subtitle = 'Paste the prompt below into your cloud agent',
  prompt,
  additionalAction,
}: PromptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 bg-white border border-zinc-200 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] dark:bg-neutral-800 dark:border-neutral-700">
        <div className="flex flex-col">
          <DialogHeader className="px-6 py-3 flex flex-col gap-1 justify-start border-b border-zinc-200 dark:border-neutral-700">
            <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white">
              {title}
            </DialogTitle>
          </DialogHeader>
          {/* Content */}
          <div className="p-6 flex flex-col gap-4">
            <p className="text-sm text-zinc-500 font-normal leading-5 dark:text-neutral-400">
              {subtitle}
            </p>
            {/* Prompt display */}
            <div className="relative">
              <pre
                className={cn(
                  'px-6 py-4 font-mono text-sm leading-5 overflow-auto whitespace-pre-wrap break-all rounded',
                  'max-h-96',
                  'bg-zinc-50 text-zinc-900 dark:bg-neutral-700 dark:text-white',
                  'border border-zinc-200 dark:border-neutral-700'
                )}
              >
                {prompt}
              </pre>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2.5">
              {additionalAction}
              <CopyButton
                text={prompt}
                showText={true}
                className="h-9 pl-2 pr-3 py-2 text-sm font-medium"
                copyText="Copy Prompt"
                copiedText="Copied!"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
