import { useState } from 'react';
import { Eye, EyeOff, Loader2, CheckCircle2, Cloud, Server, Key } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@insforge/ui';
import { useAIGatewayConfig } from '#features/ai/hooks/useAIGatewayConfig';
import type { GatewayConfigResponse } from '@insforge/shared-schemas';

function KeySourceBadge({ config }: { config: GatewayConfigResponse }) {
  if (config.keySource === 'byok') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/20 px-2 py-0.5 rounded-full">
        <Key className="w-3 h-3" />
        Your key (BYOK)
      </span>
    );
  }
  if (config.keySource === 'cloud') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/20 px-2 py-0.5 rounded-full">
        <Cloud className="w-3 h-3" />
        InsForge-managed
      </span>
    );
  }
  if (config.keySource === 'env') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted border border-[var(--alpha-8)] px-2 py-0.5 rounded-full">
        <Server className="w-3 h-3" />
        Environment variable
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive bg-destructive/10 border border-destructive/20 px-2 py-0.5 rounded-full">
      Not configured
    </span>
  );
}

interface GatewayConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GatewayConfigDialog({ open, onOpenChange }: GatewayConfigDialogProps) {
  const { gatewayConfig, isLoadingGatewayConfig, gatewayConfigError, setBYOKKey, removeBYOKKey } =
    useAIGatewayConfig();

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setApiKeyInput('');
      setShowKey(false);
      setErrorMsg('');
      setBYOKKey.reset();
      removeBYOKKey.reset();
    }
    onOpenChange(nextOpen);
  };

  const handleSave = async () => {
    if (!apiKeyInput.trim()) {
      setErrorMsg('Please enter an API key.');
      return;
    }
    setErrorMsg('');
    try {
      await setBYOKKey.mutateAsync(apiKeyInput.trim());
      setApiKeyInput('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save API key.');
    }
  };

  const handleRemove = async () => {
    setErrorMsg('');
    try {
      await removeBYOKKey.mutateAsync();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to remove API key.');
    }
  };

  const isSaving = setBYOKKey.isPending;
  const isRemoving = removeBYOKKey.isPending;
  const isBusy = isSaving || isRemoving;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gateway Credentials</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-5">
          {/* Current source */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">Active credential source</p>
            {isLoadingGatewayConfig ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : gatewayConfigError ? (
              <p className="text-xs text-destructive">
                Failed to load gateway configuration. Please close and try again.
              </p>
            ) : gatewayConfig ? (
              <div className="flex items-center gap-3">
                <KeySourceBadge config={gatewayConfig} />
                {gatewayConfig.hasByokKey && gatewayConfig.maskedKey && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {gatewayConfig.maskedKey}
                  </span>
                )}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground leading-relaxed">
              {gatewayConfig?.keySource === 'byok'
                ? 'Requests use your OpenRouter key. Usage and billing are on your OpenRouter account.'
                : gatewayConfig?.keySource === 'cloud'
                  ? 'Requests use the InsForge-managed OpenRouter key. Provide your own key below to override this.'
                  : gatewayConfig?.keySource === 'env'
                    ? 'Requests use the OPENROUTER_API_KEY environment variable. Provide a key below to manage it from the dashboard instead.'
                    : 'No OpenRouter key is configured. Add one below to enable AI features.'}
            </p>
          </div>

          {/* Divider */}
          <div className="border-t border-[var(--alpha-8)]" />

          {/* Set/replace BYOK key */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">
              {gatewayConfig?.hasByokKey ? 'Replace your key' : 'Provide your OpenRouter key'}
            </p>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-or-v1-..."
                disabled={isBusy}
                className="w-full h-9 px-3 pr-10 text-sm rounded border border-[var(--alpha-8)] bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}

            {setBYOKKey.isSuccess && (
              <p className="text-xs text-primary flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Key saved successfully.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Get your key at <span className="font-mono text-foreground">openrouter.ai/keys</span>.
              The key is validated and stored encrypted.
            </p>
          </div>

          {/* Remove BYOK option */}
          {gatewayConfig?.hasByokKey && (
            <div className="rounded border border-[var(--alpha-8)] bg-muted/40 p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Remove your key to revert to the default credential source.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleRemove()}
                disabled={isBusy}
                className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                {isRemoving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Remove key'}
              </Button>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isBusy}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={isBusy || !apiKeyInput.trim()}>
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
