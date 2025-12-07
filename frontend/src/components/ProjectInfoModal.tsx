import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { CopyButton } from '@/components';
import { cn, getBackendUrl } from '@/lib/utils/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/radix/Dialog';
import { useApiKey } from '@/lib/hooks/useMetadata';

interface ProjectInfoModalProps {
  open: boolean;
  onClose: () => void;
}

export function ProjectInfoModal({ open, onClose }: ProjectInfoModalProps) {
  const [version, setVersion] = useState<string>('');
  const [isVersionLoading, setIsVersionLoading] = useState(true);

  const { apiKey, isLoading: isApiKeyLoading } = useApiKey();

  // Get project URL from current hostname
  const projectUrl = window.location.origin;

  // Fetch version on mount
  useEffect(() => {
    if (!open) {
      return;
    }

    setIsVersionLoading(true);
    const backendUrl = getBackendUrl();

    fetch(`${backendUrl}/api/health`)
      .then((res) => res.json())
      .then((data) => {
        if (data.version) {
          setVersion(`v${data.version}`);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch version:', err);
      })
      .finally(() => {
        setIsVersionLoading(false);
      });
  }, [open]);

  // Masked API key display
  const maskedApiKey = apiKey ? `ik_${'•'.repeat(32)}` : '';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg p-0 bg-white dark:bg-neutral-800">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-gray-200 dark:border-neutral-700">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
            <Info className="w-5 h-5" />
            Project Information
          </DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Project URL */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              Project URL
            </label>
            <div className="flex items-center justify-between bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2">
              <span className="text-sm text-gray-900 dark:text-white font-mono truncate pr-2">
                {projectUrl}
              </span>
              <CopyButton
                text={projectUrl}
                showText={false}
                className="h-6 w-6 p-1 min-w-0 shrink-0 text-black bg-white dark:text-white dark:bg-neutral-700"
              />
            </div>
          </div>

          {/* API Key */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              API Key
            </label>
            <div className="flex flex-col gap-1">
              <div
                className={cn(
                  'flex items-center justify-between bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2',
                  isApiKeyLoading && 'animate-pulse'
                )}
              >
                <span className="text-sm text-gray-900 dark:text-white font-mono">
                  {isApiKeyLoading ? '•'.repeat(35) : maskedApiKey || 'Not available'}
                </span>
                {!isApiKeyLoading && apiKey && (
                  <CopyButton
                    text={apiKey}
                    showText={false}
                    className="h-6 w-6 p-1 min-w-0 shrink-0 text-black bg-white dark:text-white dark:bg-neutral-700"
                  />
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-neutral-500">
                This key has full access control to your project and should be kept secure.
              </p>
            </div>
          </div>

          {/* Version */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-neutral-300">
              Version
            </label>
            <div
              className={cn(
                'bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2',
                isVersionLoading && 'animate-pulse'
              )}
            >
              <span className="text-sm text-gray-900 dark:text-white">
                {isVersionLoading ? 'Loading...' : version || 'Unknown'}
              </span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
