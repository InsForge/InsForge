import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button, Dialog, DialogContent, ScrollArea } from '@/components';
import type { DeploymentSchema } from '../services/deployments.service';

interface DeploymentMetaDataDialogProps {
  deployment: DeploymentSchema | null;
  onOpenChange: (open: boolean) => void;
}

export function DeploymentMetaDataDialog({
  deployment,
  onOpenChange,
}: DeploymentMetaDataDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyMetadata = async () => {
    if (!deployment?.metadata) {
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(deployment.metadata, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={!!deployment} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 gap-0 bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700">
        {/* Header */}
        <div className="flex flex-col gap-6 p-6 border-b border-neutral-200 dark:border-neutral-700">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-white tracking-[-0.6px]">
              Deployment Meta Data
            </h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-300">{deployment?.id}</p>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              This metadata captures the context of this deployment and can be used for debugging or
              AI-assisted investigation.
            </p>

            {/* Meta Data Code Block */}
            <div className="bg-neutral-100 dark:bg-neutral-900 rounded h-60">
              <ScrollArea className="h-full p-3">
                <div className="inline-flex items-center px-2 bg-neutral-200 dark:bg-neutral-700 rounded mb-2">
                  <span className="text-xs text-zinc-950 dark:text-neutral-50">Meta Data</span>
                </div>
                <pre className="text-sm text-zinc-950 dark:text-white whitespace-pre-wrap font-mono">
                  {deployment?.metadata
                    ? JSON.stringify(deployment.metadata, null, 2)
                    : 'No metadata available'}
                </pre>
              </ScrollArea>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2.5 p-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClose}
            className="h-8 px-3 bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-zinc-950 dark:text-white"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleCopyMetadata()}
            className="h-8 px-3 bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400"
          >
            {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            {copied ? 'Copied' : 'Copy Meta Data'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
