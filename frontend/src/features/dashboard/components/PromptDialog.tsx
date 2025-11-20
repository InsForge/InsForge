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

export function PromptDialog({ open, onOpenChange, promptTemplate }: PromptDialogProps) {
  if (!promptTemplate) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 border border-border overflow-hidden">
        {/* Content area with border bottom */}
        <div className="flex flex-col gap-10 p-6 border-b border-border">
          {/* Header and Prompt Section */}
          <div className="flex flex-col gap-6">
            {/* Title */}
            <div className="flex flex-col gap-3">
              <h2 className="text-2xl font-semibold tracking-[-0.144px] leading-8">
                {promptTemplate.title}
              </h2>
            </div>

            {/* Prompt Box */}
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text leading-6">{promptTemplate.description}</p>
              <div className="bg-card dark:bg-neutral-900 rounded p-3 h-60 overflow-y-auto relative">
                {/* Badge only */}
                <div className="flex items-center justify-between mb-2">
                  <div className="bg-secondary-bg rounded px-2 py-0 inline-flex items-center justify-center">
                    <span className="text-xs leading-5">Prompt</span>
                  </div>
                </div>
                {/* Prompt Text */}
                <p className="text-sm leading-6 whitespace-pre-wrap">{promptTemplate.prompt}</p>
              </div>
            </div>
          </div>

          {/* Features Section */}
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text leading-6">Features included:</p>
            <div className="flex flex-col gap-1">
              {promptTemplate.features.map((feature, index) => {
                const Icon = featureIcons[feature] || Box;
                return (
                  <div key={index} className="flex items-center gap-3 h-9 px-2 py-0">
                    <CheckCircle className="w-5 h-5 text-secondary-emerald shrink-0" />
                    <Icon className="w-5 h-5 text-text shrink-0" />
                    <p className="text-sm font-medium leading-6">{feature}</p>
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
            className="h-8 px-3 text-sm font-medium bg-secondary-bg hover:bg-hover-border"
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
