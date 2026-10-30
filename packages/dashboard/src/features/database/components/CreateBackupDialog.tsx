import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@insforge/ui';

interface CreateBackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (backupName: string) => Promise<void>;
}

function getDefaultBackupName() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = now.toLocaleString('en-US', { month: 'short' });
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${day} ${month}, ${year} ${hours}:${minutes}:${seconds} (Manual)`;
}

export function CreateBackupDialog({ open, onOpenChange, onCreate }: CreateBackupDialogProps) {
  const { t } = useTranslation('chrome');
  const backupNameId = useId();
  const [backupName, setBackupName] = useState(getDefaultBackupName);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setBackupName(getDefaultBackupName());
      setIsCreating(false);
    }
  }, [open]);

  const handleCreate = async () => {
    setIsCreating(true);

    try {
      await onCreate(backupName.trim());
      onOpenChange(false);
    } catch {
      // Keep the dialog open when creation fails; the caller is responsible for reporting errors.
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[480px] p-0">
        <div className="flex flex-col">
          <DialogHeader className="gap-0">
            <div className="flex w-full items-center gap-3">
              <div className="min-w-0 flex-1">
                <DialogTitle>
                  {t('database.createBackup', { defaultValue: 'Create a Backup' })}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {t('database.createBackupDescription', {
                    defaultValue: 'Create a manual database backup.',
                  })}
                </DialogDescription>
              </div>
              <DialogCloseButton className="relative right-auto top-auto h-7 w-7 rounded p-1" />
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-6 p-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={backupNameId}
                className="text-sm font-normal leading-5 text-foreground"
              >
                {t('database.backupName', { defaultValue: 'Backup Name' })}
              </label>
              <Input
                id={backupNameId}
                value={backupName}
                onChange={(event) => setBackupName(event.target.value)}
                autoFocus
                className="h-8 px-1.5 py-1.5 text-sm leading-5"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 p-4">
            <Button
              type="button"
              variant="secondary"
              className="h-8 rounded px-2"
              disabled={isCreating}
              onClick={() => onOpenChange(false)}
            >
              {t('common.close', { defaultValue: 'Close' })}
            </Button>
            <Button
              type="button"
              className="h-8 rounded px-2"
              disabled={!backupName.trim() || isCreating}
              onClick={() => {
                void handleCreate();
              }}
            >
              {isCreating
                ? t('common.creating', { defaultValue: 'Creating...' })
                : t('common.create', { defaultValue: 'Create' })}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
