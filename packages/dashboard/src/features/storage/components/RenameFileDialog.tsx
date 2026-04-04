import React, { useState, useEffect } from 'react';
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

interface RenameFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentKey: string;
  onRename: (newKey: string) => Promise<void>;
  isRenaming: boolean;
}

export function RenameFileDialog({
  open,
  onOpenChange,
  currentKey,
  onRename,
  isRenaming,
}: RenameFileDialogProps) {
  const leafName = currentKey.split('/').pop() || currentKey;
  const prefix = currentKey.includes('/')
    ? currentKey.substring(0, currentKey.lastIndexOf('/') + 1)
    : '';

  const [newName, setNewName] = useState(leafName);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setNewName(leafName);
      setError('');
    }
  }, [open, leafName]);

  const validate = (name: string): string | null => {
    const trimmed = name.trim();
    if (!trimmed) {
      return 'File name cannot be empty';
    }
    if (trimmed === leafName) {
      return 'New name must be different from the current name';
    }
    if (trimmed.includes('..')) {
      return 'File name cannot contain ".."';
    }
    if (trimmed.startsWith('/')) {
      return 'File name cannot start with "/"';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const validationError = validate(newName);
    if (validationError) {
      setError(validationError);
      return;
    }

    const fullNewKey = prefix + newName.trim();
    try {
      await onRename(fullNewKey);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename file');
    }
  };

  const handleClose = () => {
    if (!isRenaming) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent showCloseButton={false}>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col">
          <DialogHeader className="gap-0">
            <div className="flex w-full items-start gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <DialogTitle>Rename File</DialogTitle>
                <DialogDescription>Enter a new name for this file.</DialogDescription>
              </div>
              <DialogCloseButton className="relative right-auto top-auto h-7 w-7 rounded p-1" />
            </div>
          </DialogHeader>
          <DialogBody className="gap-2 p-4">
            <div className="flex w-full flex-col gap-1">
              <label htmlFor="rename-input" className="text-sm leading-5 text-foreground">
                File Name
              </label>
              <Input
                id="rename-input"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setError('');
                }}
                placeholder="Enter new file name"
                className="h-8 rounded px-1.5 py-1.5 text-sm leading-5"
                autoFocus
                disabled={isRenaming}
              />
              {prefix && (
                <p className="text-[13px] leading-[18px] text-muted-foreground">
                  Full path: {prefix}
                  {newName.trim() || '...'}
                </p>
              )}
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
              disabled={isRenaming || !newName.trim() || newName.trim() === leafName}
              className="h-8 px-2"
            >
              {isRenaming ? 'Renaming...' : 'Rename'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
