import { Dialog, DialogContent } from '@/components/radix/Dialog';
import { CheckCircle, Lock, Database, HardDrive, Code2, Box } from 'lucide-react';
import { CopyButton } from '@/components/CopyButton';
import { Button } from '@/components/radix/Button';
import type { PromptTemplate } from '../prompts';

interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promptTemplate: PromptTemplate | null;
}

const featureIcons: Record<string, typeof Lock> = {
  Authentication: Lock,
  Database: Database,
  Storage: HardDrive,
  Functions: Code2,
  'AI Integration': Box,
};

export function PromptDialog({
  open,
  onOpenChange,
  promptTemplate,
}: PromptDialogProps) {
  if (!promptTemplate) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 overflow-hidden">
        {/* Content area with border bottom */}
        <div className="flex flex-col gap-10 p-6 border-b border-gray-200 dark:border-neutral-700">
          {/* Header and Prompt Section */}
          <div className="flex flex-col gap-6">
            {/* Title */}
            <div className="flex flex-col gap-3">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white tracking-[-0.144px] leading-8">
                {promptTemplate.title}
              </h2>
            </div>

            {/* Prompt Box */}
            <div className="flex flex-col gap-3">
              <p className="text-sm text-gray-500 dark:text-neutral-400 leading-6">
                {promptTemplate.description}
              </p>
              <div className="bg-gray-50 dark:bg-neutral-900 rounded p-3 h-60 overflow-y-auto relative">
                {/* Badge only */}
                <div className="flex items-center justify-between mb-2">
                  <div className="bg-gray-200 dark:bg-neutral-700 rounded px-2 py-0 inline-flex items-center justify-center">
                    <span className="text-xs text-gray-900 dark:text-neutral-50 leading-5">
                      Prompt
                    </span>
                  </div>
                </div>
                {/* Prompt Text */}
                <p className="text-sm text-gray-900 dark:text-white leading-6 whitespace-pre-wrap">
                  {promptTemplate.prompt}
                </p>
              </div>
            </div>
          </div>

          {/* Features Section */}
          <div className="flex flex-col gap-3">
            <p className="text-sm text-gray-500 dark:text-neutral-400 leading-6">
              Features included:
            </p>
            <div className="flex flex-col gap-1">
              {promptTemplate.features.map((feature, index) => {
                const Icon = featureIcons[feature] || Box;
                return (
                  <div key={index} className="flex items-center gap-3 h-9 px-2 py-0">
                    <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
                    <Icon className="w-5 h-5 text-gray-500 dark:text-neutral-400 shrink-0" />
                    <p className="text-sm text-gray-900 dark:text-white font-medium leading-6">
                      {feature}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 p-3">
          <Button
            onClick={() => onOpenChange(false)}
            variant="secondary"
            className="h-8 px-3 text-sm font-medium bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-neutral-700 dark:text-white dark:hover:bg-neutral-600"
          >
            Cancel
          </Button>
          <CopyButton
            text={promptTemplate.prompt}
            showText={true}
            variant="primary"
            className="h-8 px-3 text-sm font-medium"
            copyText="Copy Prompt"
            copiedText="Copied!"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
