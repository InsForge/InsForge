import { useState } from 'react';
import { CircleAlert } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@insforge/ui';

interface ConfirmRestoreDialogProps {
  open: boolean;
  backupTimestampLabel: string;
  onOpenChange: (open: boolean) => void;
  onRestore: () => Promise<void>;
}

export function ConfirmRestoreDialog({
  open,
  backupTimestampLabel,
  onOpenChange,
  onRestore,
}: ConfirmRestoreDialogProps) {
  const [isRestoring, setIsRestoring] = useState(false);

  const handleRestore = async () => {
    setIsRestoring(true);

    try {
      await onRestore();
      onOpenChange(false);
    } catch {
      // Keep the dialog open when restore fails; the caller is responsible for reporting errors.
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[640px] p-0">
        <div className="flex flex-col">
          <DialogHeader className="gap-0">
            <div className="flex w-full items-center gap-3">
              <div className="min-w-0 flex-1">
                <DialogTitle>Restore from Backup</DialogTitle>
                <DialogDescription className="sr-only">
                  Confirm restoring the database from a selected backup.
                </DialogDescription>
              </div>
              <DialogCloseButton className="relative right-auto top-auto h-7 w-7 rounded p-1" />
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-2 p-4">
            <p className="text-sm leading-6 text-foreground">
              This will restore your database to the selected backup from{' '}
              <span className="font-bold">{backupTimestampLabel}</span>
            </p>

            <div className="flex items-start gap-2 text-[rgb(var(--warning))]">
              <CircleAlert className="mt-0.5 h-6 w-6 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium leading-6">This action cannot be undone</p>
                <ul className="list-disc pl-5 text-sm leading-6">
                  <li>Your project will be offline during the restore</li>
                  <li>Any data created after this backup will be lost</li>
                </ul>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-3 p-4">
            <Button
              type="button"
              variant="secondary"
              className="h-8 rounded px-2"
              disabled={isRestoring}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="h-8 rounded bg-[rgb(var(--warning))] px-2 text-[rgb(var(--inverse))] hover:opacity-90"
              disabled={isRestoring}
              onClick={() => {
                void handleRestore();
              }}
            >
              {isRestoring ? 'Restoring...' : 'Restore'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
