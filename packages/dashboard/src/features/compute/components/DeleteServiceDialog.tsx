import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@insforge/ui';

interface DeleteServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceName: string;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

// Type-to-confirm delete dialog. Compute deletes are unrecoverable — the OSS
// row is hard-deleted and the Fly app + image are GC'd shortly after — so
// the dashboard requires the operator to retype the service name to enable
// the destructive button. Same pattern Heroku/Vercel/Linear use for the same
// reason: a single click should not be able to vaporize a running service.
export function DeleteServiceDialog({
  open,
  onOpenChange,
  serviceName,
  onConfirm,
  isLoading = false,
}: DeleteServiceDialogProps) {
  const [typed, setTyped] = useState('');

  // Reset the typed value whenever the dialog (re)opens or the target service
  // changes. Otherwise stale text from a previous attempt could pre-arm the
  // delete button against a different service.
  useEffect(() => {
    if (open) {
      setTyped('');
    }
  }, [open, serviceName]);

  const matches = typed === serviceName && serviceName.length > 0;

  const handleConfirm = async () => {
    if (!matches) {
      return;
    }
    await onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Delete service</DialogTitle>
        </DialogHeader>

        <div className="p-4 flex flex-col gap-4">
          <DialogDescription>
            This will permanently delete{' '}
            <span className="font-mono font-medium text-foreground">{serviceName}</span> and destroy
            its Fly.io resources. The container image is garbage-collected shortly after and cannot
            be recovered.
          </DialogDescription>

          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="confirm-delete-name">
              Type <span className="font-mono text-foreground">{serviceName}</span> to confirm:
            </label>
            <Input
              id="confirm-delete-name"
              value={typed}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={serviceName}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            size="lg"
            disabled={isLoading}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="lg"
            disabled={isLoading || !matches}
            onClick={() => {
              void handleConfirm();
            }}
          >
            {isLoading ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
