import React, { useState, useEffect } from 'react';
import { useStorage } from '@/features/storage/hooks/useStorage';
import { isInsForgeCloudProject } from '@/lib/utils/utils';
import DiscordIcon from '@/assets/logos/discord.svg?react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
} from '@/components';

interface BucketFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (bucketName?: string) => void;
  mode: 'create' | 'edit';
  initialBucketName?: string;
  initialIsPublic?: boolean;
}

export function BucketFormDialog({
  open,
  onOpenChange,
  onSuccess,
  mode,
  initialBucketName = '',
  initialIsPublic = true,
}: BucketFormDialogProps) {
  const [bucketName, setBucketName] = useState(initialBucketName);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [error, setError] = useState('');

  const { createBucket, editBucket, isCreatingBucket, isEditingBucket } = useStorage();

  useEffect(() => {
    if (open) {
      if (mode === 'edit') {
        setBucketName(initialBucketName);
        setIsPublic(initialIsPublic);
      } else {
        setBucketName('');
        setIsPublic(true);
      }
      setError('');
    }
  }, [open, mode, initialBucketName, initialIsPublic]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    if (mode === 'create') {
      if (!bucketName.trim()) {
        setError('Bucket name is required');
        return;
      }
      try {
        await createBucket({ bucketName: bucketName.trim(), isPublic });
        onSuccess(bucketName);
        handleClose();
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to create bucket');
      }
    } else {
      try {
        await editBucket({ bucketName, config: { isPublic } });
        onSuccess();
        handleClose();
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to update bucket');
      }
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const isLoading = mode === 'create' ? isCreatingBucket : isEditingBucket;
  const submitButtonText =
    mode === 'create'
      ? isLoading
        ? 'Creating...'
        : 'Create Bucket'
      : isLoading
        ? 'Saving...'
        : 'Save Changes';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[480px] p-0 border-zinc-200 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)]">
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col">
          <DialogHeader className="px-6 py-3 flex flex-col gap-1 justify-start border-b border-zinc-200 dark:border-neutral-700">
            <DialogTitle className="text-lg font-semibold text-zinc-950 dark:text-white">
              {mode === 'create' ? 'Create New Bucket' : 'Edit Bucket'}
            </DialogTitle>
            {mode === 'create' && (
              <DialogDescription className="text-sm text-zinc-500">
                Create a new storage bucket to organize your files.
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="flex flex-col gap-6 p-6">
            <div className="flex flex-row justify-between gap-10">
              <Label
                htmlFor="bucket-name"
                className="text-sm font-medium text-zinc-950 dark:text-zinc-300"
              >
                Bucket Name
              </Label>
              <div className="w-70 flex flex-col gap-1">
                <Input
                  id="bucket-name"
                  value={bucketName}
                  onChange={(e) => {
                    if (mode === 'create') {
                      setBucketName(e.target.value);
                      setError('');
                    }
                  }}
                  placeholder={mode === 'create' ? 'Enter a name' : ''}
                  disabled={mode === 'edit'}
                  className={`w-full h-9 px-3 py-2 bg-transparent dark:bg-neutral-900 ${mode === 'edit' ? 'cursor-not-allowed' : ''} dark:text-white dark:placeholder:text-neutral-400 dark:border-neutral-700`}
                  autoFocus={mode === 'create'}
                />
                {error && <p className="text-sm text-red-600 dark:text-red-500">{error}</p>}
                <p className="text-xs font-medium text-zinc-500 dark:text-neutral-400">
                  {mode === 'create'
                    ? 'Use lowercase letters, numbers, hyphens, and underscores only.'
                    : 'Bucket name cannot be changed.'}
                </p>
              </div>
            </div>
            <div className="flex flex-row justify-between gap-10">
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="bucket-public"
                  className="text-sm font-medium text-zinc-950 dark:text-white"
                >
                  Public
                </Label>
                <Switch
                  id="bucket-public"
                  checked={isPublic}
                  onCheckedChange={setIsPublic}
                  className="h-6"
                />
              </div>
              <p className="w-70 text-xs font-medium text-zinc-500 dark:text-neutral-400">
                If enabled, files in this bucket can be accessed without authentication.
              </p>
            </div>

            {/* File Size Limit - Cloud only, edit mode only */}
            {mode === 'edit' && isInsForgeCloudProject() && (
              <div className="flex flex-row justify-between gap-10">
                <Label className="text-sm font-medium text-zinc-950 dark:text-zinc-300">
                  File Size Limit
                </Label>
                <div className="w-70 flex flex-col gap-1">
                  <p className="text-sm text-zinc-950 dark:text-white">50MB per file</p>
                  <p className="text-xs font-medium text-zinc-500 dark:text-neutral-400">
                    Need a higher limit? Reach out to us on{' '}
                    <a
                      href="https://discord.gg/DvBtaEc9Jz"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 align-middle"
                    >
                      <DiscordIcon className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                      <span className="text-indigo-500 dark:text-indigo-400 font-medium">
                        Discord
                      </span>
                    </a>
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="p-6 gap-3 border-t border-zinc-200 dark:border-neutral-700">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="w-30 h-9 px-3 py-2 text-sm font-medium dark:bg-neutral-600 dark:text-zinc-300 dark:border-neutral-600 dark:hover:bg-neutral-700"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || (mode === 'create' && !bucketName.trim())}
              className="w-30 h-9 px-3 py-2 text-sm font-medium bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-400"
            >
              {submitButtonText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
