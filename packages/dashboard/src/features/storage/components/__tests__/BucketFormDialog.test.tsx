import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BucketFormDialog } from '#features/storage/components/BucketFormDialog';

const bucketMocks = vi.hoisted(() => ({
  createBucket: vi.fn(),
  editBucket: vi.fn(),
}));

vi.mock('#features/storage/hooks/useBuckets', () => ({
  useBuckets: () => ({
    createBucket: bucketMocks.createBucket,
    editBucket: bucketMocks.editBucket,
    isCreatingBucket: false,
    isEditingBucket: false,
  }),
}));

describe('BucketFormDialog', () => {
  afterEach(() => {
    bucketMocks.createBucket.mockReset();
    bucketMocks.editBucket.mockReset();
  });

  it('creates a bucket with a trimmed name and closes on success', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    bucketMocks.createBucket.mockResolvedValue(undefined);

    render(
      <BucketFormDialog open onOpenChange={onOpenChange} onSuccess={onSuccess} mode="create" />
    );

    await user.type(screen.getByPlaceholderText('Enter a name'), ' logs ');
    await user.click(screen.getByRole('button', { name: 'Create Bucket' }));

    await waitFor(() => {
      expect(bucketMocks.createBucket).toHaveBeenCalledWith({
        bucketName: 'logs',
        isPublic: false,
      });
      expect(onSuccess).toHaveBeenCalledWith('logs');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
