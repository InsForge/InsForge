import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  InputField,
} from '@insforge/ui';
import type { MarketplacePluginWithStatus } from '@insforge/shared-schemas';
import { PluginAvatar } from '#features/marketplace/components/PluginAvatar';

interface InstallPluginDialogProps {
  plugin: MarketplacePluginWithStatus | null;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall: (slug: string, apiKey: string) => Promise<unknown>;
  installing: boolean;
  onUninstall: (slug: string) => Promise<unknown>;
  uninstalling: boolean;
}

export function InstallPluginDialog({
  plugin,
  projectName,
  open,
  onOpenChange,
  onInstall,
  installing,
  onUninstall,
  uninstalling,
}: InstallPluginDialogProps) {
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');

  // Reset the form each time the dialog opens
  useEffect(() => {
    if (open) {
      setApiKeyValue('');
      setApiKeyError('');
    }
  }, [open, plugin?.slug]);

  if (!plugin) {
    return null;
  }

  const handleInstall = async () => {
    if (installing) {
      return;
    }
    if (!apiKeyValue.trim()) {
      setApiKeyError(`Enter your ${plugin.install.secretName} to continue`);
      return;
    }
    try {
      await onInstall(plugin.slug, apiKeyValue.trim());
      onOpenChange(false);
    } catch (error) {
      setApiKeyError(error instanceof Error ? error.message : 'Failed to install plugin');
    }
  };

  const handleUninstall = async () => {
    if (uninstalling) {
      return;
    }
    try {
      await onUninstall(plugin.slug);
      onOpenChange(false);
    } catch {
      // Error toast comes from the mutation; keep the dialog open
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[480px] max-w-[480px] gap-0 rounded-xl border-[var(--alpha-12)] bg-[rgb(var(--semantic-2))] p-0"
      >
        <div className="flex items-center gap-3.5 border-b border-[var(--border)] px-6 py-5">
          <PluginAvatar plugin={plugin} size="lg" />
          <div className="flex flex-1 flex-col gap-0.5">
            <DialogTitle className="text-base font-semibold leading-normal">
              {plugin.installed ? plugin.name : `Install ${plugin.name}`}
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-normal">
              {plugin.installed
                ? `Installed in project ${projectName}`
                : `Into project ${projectName}`}
            </DialogDescription>
          </div>
          <DialogClose className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground">
            <X className="h-[18px] w-[18px]" />
          </DialogClose>
        </div>
        <div className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-2.5">
            <span className="text-[13px] font-medium text-foreground">
              {plugin.installed ? 'This plugin has:' : 'This plugin will:'}
            </span>
            <div className="flex flex-col gap-2">
              {plugin.actions.map((action) => (
                <div
                  key={action}
                  className="flex items-center gap-2.5 text-[13px] text-muted-foreground"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{action}</span>
                </div>
              ))}
            </div>
          </div>
          {!plugin.installed && (
            <InputField
              label={plugin.install.secretName}
              placeholder={plugin.install.placeholder}
              value={apiKeyValue}
              onChange={(event) => {
                setApiKeyValue(event.target.value);
                setApiKeyError('');
              }}
              error={apiKeyError || undefined}
              showIcon={false}
              showDropdown={false}
              showTip={false}
            />
          )}
          {plugin.installed && (
            <p className="m-0 text-[13px] leading-normal text-muted-foreground">
              Uninstalling deactivates the {plugin.install.secretName} secret. Functions using it
              will lose access after the next deployment.
            </p>
          )}
        </div>
        <DialogFooter className="gap-2 border-[var(--border)] px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {plugin.installed ? (
            <Button
              variant="destructive"
              disabled={uninstalling}
              onClick={() => void handleUninstall()}
            >
              {uninstalling ? 'Uninstalling...' : 'Uninstall'}
            </Button>
          ) : (
            <Button variant="primary" disabled={installing} onClick={() => void handleInstall()}>
              {installing ? 'Installing...' : 'Install plugin'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
