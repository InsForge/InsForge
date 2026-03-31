import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@insforge/ui';
import type { StorageFileSchema } from '@insforge/shared-schemas';

interface RenameFileDialogProps {
  file: StorageFileSchema | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (newName: string) => Promise<void>;
  isRenaming?: boolean;
}

function getCurrentFileName(key?: string): string {
  if (!key || key.endsWith('/')) {
    return '';
  }

  return key.split('/').pop() || '';
}

export function RenameFileDialog({
  file,
  open,
  onOpenChange,
  onRename,
  isRenaming = false,
}: RenameFileDialogProps) {
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const currentName = useMemo(() => {
    return getCurrentFileName(file?.key);
  }, [file]);

  useEffect(() => {
    if (open) {
      setNewName(currentName);
      setError('');
    }
  }, [open, currentName]);

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedName = newName.trim();
    if (!trimmedName) {
      setError('File name is required');
      return;
    }

    if (!currentName) {
      setError('Only files can be renamed');
      return;
    }

    try {
      await onRename(trimmedName);
      handleClose();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Failed to rename file');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent showCloseButton={false}>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col">
          <DialogHeader className="gap-0">
            <div className="flex w-full items-start gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <DialogTitle>Rename File</DialogTitle>
                <DialogDescription>
                  Update the file name while keeping it in the same folder.
                </DialogDescription>
              </div>
              <DialogCloseButton className="relative right-auto top-auto h-7 w-7 rounded p-1" />
            </div>
          </DialogHeader>
          <DialogBody className="gap-2 p-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="rename-file-name" className="text-sm leading-5 text-foreground">
                File Name
              </label>
              <Input
                id="rename-file-name"
                value={newName}
                onChange={(event) => {
                  setNewName(event.target.value);
                  setError('');
                }}
                placeholder="Enter a new file name"
                autoFocus
                disabled={isRenaming}
                className="h-8 rounded px-1.5 py-1.5 text-sm leading-5"
              />
              <p className="text-[13px] leading-[18px] text-muted-foreground">
                Current name: {currentName || 'Unknown file'}
              </p>
              {error && <p className="text-[13px] leading-[18px] text-destructive">{error}</p>}
            </div>
          </DialogBody>
          <DialogFooter className="gap-3 p-4">
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              className="h-8 px-2"
              disabled={isRenaming}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="h-8 px-2"
              disabled={
                isRenaming || !currentName || !newName.trim() || newName.trim() === currentName
              }
            >
              {isRenaming ? 'Renaming...' : 'Rename'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
