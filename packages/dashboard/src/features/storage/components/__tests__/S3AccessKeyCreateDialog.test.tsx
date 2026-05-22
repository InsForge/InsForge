import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { S3AccessKeyWithSecretSchema } from '@insforge/shared-schemas';
import { describe, expect, it, vi } from 'vitest';
import { S3AccessKeyCreateDialog } from '#features/storage/components/S3AccessKeyCreateDialog';

const createdKey: S3AccessKeyWithSecretSchema = {
  id: '00000000-0000-4000-8000-000000000001',
  accessKeyId: 'INSFABCDEF1234567890',
  description: 'ci uploader',
  createdAt: '2026-05-17T00:00:00.000Z',
  lastUsedAt: null,
  secretAccessKey: 'a'.repeat(40),
};

describe('S3AccessKeyCreateDialog', () => {
  it('creates a key, displays the secret, and requires acknowledgement before closing', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(createdKey);
    const onOpenChange = vi.fn();

    render(
      <S3AccessKeyCreateDialog
        open
        onOpenChange={onOpenChange}
        onCreate={onCreate}
        isCreating={false}
      />
    );

    await user.type(
      screen.getByPlaceholderText('e.g. backup-script, ci-uploader'),
      ' ci uploader '
    );
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('ci uploader');
      expect(screen.getByText('S3 Access Key Created')).toBeTruthy();
      expect(screen.getByDisplayValue(createdKey.accessKeyId)).toBeTruthy();
    });

    const doneButton = screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement;
    expect(doneButton.disabled).toBe(true);

    await user.click(screen.getByText('I have saved the Secret Access Key in a safe place.'));
    expect(doneButton.disabled).toBe(false);

    await user.click(doneButton);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
