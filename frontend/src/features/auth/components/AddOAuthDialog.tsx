import { useState, useEffect } from 'react';
import { Button } from '@/components/radix/Button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/radix/Dialog';
import { cn } from '@/lib/utils/utils';
import type { OAuthProvidersSchema } from '@insforge/shared-schemas';
import type { OAuthProviderInfo } from '../helpers';

interface AddOAuthDialogProps {
  providers: OAuthProviderInfo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (selectedId: OAuthProvidersSchema) => void;
  enabledProviders: Record<OAuthProvidersSchema, boolean>;
}

export function AddOAuthDialog({
  providers,
  open,
  onOpenChange,
  onConfirm,
  enabledProviders,
}: AddOAuthDialogProps) {
  const [selectedId, setSelectedId] = useState<OAuthProvidersSchema | null>(null);

  // Reset selection when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedId(null);
    }
  }, [open]);

  const hasSelection = selectedId !== null;

  // Filter out already enabled providers
  const availableProviders = providers.filter((provider) => !enabledProviders[provider.id]);

  const selectProvider = (id: OAuthProvidersSchema) => {
    setSelectedId(id);
  };

  const handleConfirm = () => {
    if (selectedId) {
      onConfirm(selectedId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[600px] p-0 gap-0 dark:bg-neutral-800">
        <DialogHeader className="pl-6 pr-4 py-3 border-b border-zinc-200 dark:border-neutral-700">
          <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white">
            Add Authentication
          </DialogTitle>
        </DialogHeader>
        <div className="p-6">
          {availableProviders.length ? (
            <div className="grid grid-cols-2 gap-3">
              {availableProviders.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectProvider(p.id)}
                  className={cn(
                    'flex items-center justify-start gap-3 rounded-[8px] border border-transparent p-3 transition-colors',
                    selectedId === p.id
                      ? 'bg-zinc-50 hover:bg-zinc-100 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30 border-black dark:border-emerald-600'
                      : 'bg-white hover:bg-zinc-100 dark:bg-[#333333] dark:hover:bg-neutral-700 border-neutral-200 dark:border-neutral-700'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {p.icon}
                    <p className="text-sm font-medium text-zinc-950 dark:text-white">{p.name}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-zinc-500 dark:text-neutral-400">
                All authentication methods have been added.
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="px-6 py-4 border-t border-zinc-200 dark:border-neutral-700">
          <Button
            variant="outline"
            className="w-fit h-9 px-3 py-2 rounded-sm dark:bg-neutral-600 dark:text-white dark:border-transparent dark:hover:bg-neutral-700"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="h-9 px-3 py-2 rounded-sm dark:bg-emerald-300 dark:text-black dark:hover:bg-emerald-400"
            onClick={handleConfirm}
            disabled={!hasSelection}
          >
            Add OAuth
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
