import { useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff } from 'lucide-react';
import {
  Button,
  Checkbox,
  CopyButton,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@insforge/ui';
import type { S3AccessKeyWithSecretSchema } from '@insforge/shared-schemas';

interface S3AccessKeyCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (description: string | undefined) => Promise<S3AccessKeyWithSecretSchema>;
  isCreating: boolean;
}

/**
 * Two-stage dialog:
 * 1. Ask for an optional description and call `onCreate`.
 * 2. Display the returned access-key id + plaintext secret with copy
 *    controls. The secret is shown exactly once; we keep the dialog open
 *    until the user checks "I have saved the credentials" and clicks Done,
 *    forcing explicit acknowledgement before the secret leaves the screen.
 */
export function S3AccessKeyCreateDialog({
  open,
  onOpenChange,
  onCreate,
  isCreating,
}: S3AccessKeyCreateDialogProps) {
  const [description, setDescription] = useState('');
  const [result, setResult] = useState<S3AccessKeyWithSecretSchema | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset all state whenever the dialog closes. In particular, we must clear
  // `result` so the plaintext secret isn't retained on the client longer
  // than necessary.
  useEffect(() => {
    if (!open) {
      setDescription('');
      setResult(null);
      setSecretVisible(false);
      setAcknowledged(false);
    }
  }, [open]);

  const handleCreate = async () => {
    const trimmed = description.trim();
    try {
      const r = await onCreate(trimmed.length > 0 ? trimmed : undefined);
      setResult(r);
    } catch {
      // Parent already surfaces a toast on error via the mutation hook.
    }
  };

  const handleClose = (next: boolean) => {
    // Block the "click-away to close" once the secret is visible — the user
    // has to explicitly acknowledge that they've saved it.
    if (!next && result && !acknowledged) {
      return;
    }
    onOpenChange(next);
  };

  const showingSecret = result !== null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{showingSecret ? 'S3 Access Key Created' : 'New S3 Access Key'}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          {!showingSecret ? (
            <div className="flex flex-col gap-3">
              <label className="text-sm text-foreground">
                Description <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                placeholder="e.g. backup-script, ci-uploader"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
                disabled={isCreating}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                A short label to help you identify this key later. Only you see it.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
                <div>
                  <p className="font-medium">Copy the Secret Access Key now.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    We will not show it again. If you lose it, revoke this key and create a new one.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-foreground">Access Key ID</label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={result.accessKeyId} className="font-mono text-sm" />
                  <CopyButton text={result.accessKeyId} showText={false} />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm text-foreground">Secret Access Key</label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    type={secretVisible ? 'text' : 'password'}
                    value={result.secretAccessKey}
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={secretVisible ? 'Hide secret' : 'Show secret'}
                    onClick={() => setSecretVisible((v) => !v)}
                  >
                    {secretVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <CopyButton text={result.secretAccessKey} showText={false} />
                </div>
              </div>

              <label className="flex items-start gap-2 pt-1 text-sm text-foreground">
                <Checkbox
                  checked={acknowledged}
                  onCheckedChange={(v) => setAcknowledged(v === true)}
                  className="mt-0.5"
                />
                <span>I have saved the Secret Access Key in a safe place.</span>
              </label>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          {!showingSecret ? (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button type="button" onClick={() => void handleCreate()} disabled={isCreating}>
                {isCreating ? 'Creating...' : 'Create'}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => onOpenChange(false)} disabled={!acknowledged}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
