import React, { useState, useEffect } from 'react';
import { useBuckets } from '#features/storage/hooks/useBuckets';
import { isInsForgeCloudProject } from '#lib/utils/utils';
import DiscordIcon from '#assets/logos/discord.svg?react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogDivider,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
} from '@insforge/ui';

interface BucketFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (bucketName?: string) => void;
  mode: 'create' | 'edit';
  initialBucketName?: string;
  initialIsPublic?: boolean;
}

interface BucketFormRowProps {
  label: string;
  description: string;
  children: React.ReactNode;
}

function BucketFormRow({ label, description, children }: BucketFormRowProps) {
  return (
    <div className="flex w-full items-start gap-6">
      <div className="flex w-80 shrink-0 flex-col gap-2">
        <p className="flex h-8 items-center text-sm leading-5 text-foreground">{label}</p>
        <p className="pb-2 text-[13px] leading-[18px] text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function BucketFormDialog({
  open,
  onOpenChange,
  onSuccess,
  mode,
  initialBucketName = '',
  initialIsPublic = false,
}: BucketFormDialogProps) {
  const [bucketName, setBucketName] = useState(initialBucketName);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [error, setError] = useState('');

  const { createBucket, editBucket, isCreatingBucket, isEditingBucket } = useBuckets();

  useEffect(() => {
    if (open) {
      if (mode === 'edit') {
        setBucketName(initialBucketName);
        setIsPublic(initialIsPublic);
      } else {
        setBucketName('');
        setIsPublic(initialIsPublic);
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
        onSuccess(bucketName.trim());
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
  const title = mode === 'create' ? 'Create New Bucket' : 'Edit Bucket';
  const description =
    mode === 'create'
      ? 'Create a new storage bucket to organize your files.'
      : "Update this storage bucket's settings.";
  const bucketNameHelpText =
    mode === 'create'
      ? 'Use lowercase letters, numbers, hyphens, and underscores only.'
      : 'Bucket name cannot be changed.';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent showCloseButton={false}>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col">
          <DialogHeader className="gap-0">
            <div className="flex w-full items-start gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
              </div>
              <DialogCloseButton className="relative right-auto top-auto h-7 w-7 rounded p-1" />
            </div>
          </DialogHeader>
          <DialogBody className="gap-2 p-4">
            <BucketFormRow label="Bucket Name" description={bucketNameHelpText}>
              <div className="flex w-full flex-col gap-1">
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
                  className={`h-8 rounded px-1.5 py-1.5 text-sm leading-5 ${mode === 'edit' ? 'cursor-not-allowed' : ''}`}
                  autoFocus={mode === 'create'}
                />
                {error && <p className="text-[13px] leading-[18px] text-destructive">{error}</p>}
              </div>
            </BucketFormRow>

            <DialogDivider />

            <BucketFormRow
              label="Public Bucket"
              description="If enabled, files in this bucket can be accessed without authentication."
            >
              <div className="flex h-8 w-full items-center justify-end">
                <Switch id="bucket-public" checked={isPublic} onCheckedChange={setIsPublic} />
              </div>
            </BucketFormRow>

            {/* File Size Limit - Cloud only, edit mode only */}
            {mode === 'edit' && isInsForgeCloudProject() && (
              <>
                <DialogDivider />
                <BucketFormRow
                  label="File Size Limit"
                  description="Default limit for cloud projects."
                >
                  <div className="flex w-full flex-col gap-1">
                    <p className="text-sm leading-5 text-foreground">50MB per file</p>
                    <p className="text-[13px] leading-[18px] text-muted-foreground">
                      Need a higher limit? Reach out to us on{' '}
                      <a
                        href="https://discord.gg/DvBtaEc9Jz"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 align-middle text-primary"
                      >
                        <DiscordIcon className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-medium leading-4 text-primary">Discord</span>
                      </a>
                    </p>
                  </div>
                </BucketFormRow>
              </>
            )}
          </DialogBody>
          <DialogFooter className="gap-3 p-4">
            <Button type="button" variant="secondary" onClick={handleClose} className="h-8 px-2">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || (mode === 'create' && !bucketName.trim())}
              className="h-8 px-2"
            >
              {submitButtonText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
