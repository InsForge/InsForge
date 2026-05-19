import { useEffect, useId, useState } from 'react';
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

interface RenameFileDialogProps {
  open: boolean;
  initialName: string;
  onOpenChange: (open: boolean) => void;
  onSave: (fileName: string) => Promise<void>;
}

export function RenameFileDialog({
  open,
  initialName,
  onOpenChange,
  onSave,
}: RenameFileDialogProps) {
  const fileNameId = useId();
  const [fileName, setFileName] = useState(initialName);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setFileName(initialName);
      setIsSaving(false);
    }
  }, [initialName, open]);

  const handleSave = async () => {
    setIsSaving(true);

    try {
      await onSave(fileName.trim());
      onOpenChange(false);
    } catch {
      // Keep the dialog open when saving fails; the caller handles the error state.
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-[480px] p-0">
        <div className="flex flex-col">
          <DialogHeader className="gap-0">
            <div className="flex w-full items-center gap-3">
              <div className="min-w-0 flex-1">
                <DialogTitle>Rename File</DialogTitle>
                <DialogDescription className="sr-only">Rename a storage file.</DialogDescription>
              </div>
              <DialogCloseButton className="relative right-auto top-auto h-7 w-7 rounded p-1" />
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-6 p-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={fileNameId} className="text-sm font-normal leading-5 text-foreground">
                File Name
              </label>
              <Input
                id={fileNameId}
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
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
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            <Button
              type="button"
              className="h-8 rounded px-2"
              disabled={!fileName.trim() || isSaving}
              onClick={() => {
                void handleSave();
              }}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
