import React, { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { storageService } from '@/features/storage/services/storage.service';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/radix/Dialog';
import { Button } from '@/components/radix/Button';
import { Input } from '@/components/radix/Input';
import { Label } from '@/components/radix/Label';
import { Switch } from '@/components/radix/Switch';
import { useToast } from '@/lib/hooks/useToast';

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
  const { showToast } = useToast();

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

  const createBucketMutation = useMutation({
    mutationFn: ({ name, isPublic }: { name: string; isPublic: boolean }) =>
      storageService.createBucket(name, isPublic),
    onSuccess: () => {
      onSuccess(bucketName);
      showToast('Bucket created successfully', 'success');
      handleClose();
    },
    onError: (error: any) => {
      setError(error.response?.data?.error?.message || error.message || 'Failed to create bucket');
    },
  });

  const editBucketMutation = useMutation({
    mutationFn: ({ name, isPublic }: { name: string; isPublic: boolean }) =>
      storageService.editBucket(name, { isPublic: isPublic }),
    onSuccess: () => {
      onSuccess();
      showToast('Bucket updated successfully', 'success');
      handleClose();
    },
    onError: (error: any) => {
      setError(error.response?.data?.error?.message || error.message || 'Failed to update bucket');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === 'create') {
      if (!bucketName.trim()) {
        setError('Bucket name is required');
        return;
      }
      createBucketMutation.mutate({ name: bucketName.trim(), isPublic });
    } else {
      editBucketMutation.mutate({ name: bucketName, isPublic });
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const isLoading =
    mode === 'create' ? createBucketMutation.isPending : editBucketMutation.isPending;
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
      <DialogContent className="w-[640px] p-0 border-zinc-200 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="text-base font-semibold text-zinc-950">
              {mode === 'create' ? 'Create New Bucket' : 'Edit Bucket'}
            </DialogTitle>
            {mode === 'create' && (
              <DialogDescription className="text-sm text-zinc-500">
                Create a new storage bucket to organize your files.
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="flex flex-col gap-6 px-6">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3">
                <Label htmlFor="bucket-name" className="text-sm font-medium text-zinc-950">
                  Bucket Name
                </Label>
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
                  className={`h-10 px-3 py-2 text-base ${mode === 'edit' ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                  autoFocus={mode === 'create'}
                />
                {error && <p className="text-sm text-red-600">{error}</p>}
              </div>
              <p className="text-sm text-zinc-500">
                {mode === 'create'
                  ? 'Use lowercase letters, numbers and hyphens only.'
                  : 'Bucket name cannot be changed.'}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Label htmlFor="bucket-public" className="text-sm font-medium text-zinc-950">
                  Public
                </Label>
                <Switch
                  id="bucket-public"
                  checked={isPublic}
                  onCheckedChange={setIsPublic}
                  className="h-6 data-[state=checked]:bg-zinc-950 data-[state=unchecked]:bg-zinc-200"
                />
              </div>
              <p className="text-sm text-zinc-500">
                If enabled, files in this bucket can be accessed without authentication.
              </p>
            </div>
          </div>
          <DialogFooter className="px-6 pb-6 gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="h-10 px-4 py-2 text-sm font-medium"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || (mode === 'create' && !bucketName.trim())}
              className="h-10 px-4 py-2 text-sm font-medium bg-zinc-950 text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              {submitButtonText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
