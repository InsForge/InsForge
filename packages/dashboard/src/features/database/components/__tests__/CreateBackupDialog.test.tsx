import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateBackupDialog } from '#features/database/components/CreateBackupDialog';

describe('CreateBackupDialog', () => {
  it('creates a backup with a trimmed name and closes on success', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(<CreateBackupDialog open onOpenChange={onOpenChange} onCreate={onCreate} />);

    const input = screen.getByLabelText('Backup Name');
    await user.clear(input);
    await user.type(input, ' release backup ');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('release backup');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
