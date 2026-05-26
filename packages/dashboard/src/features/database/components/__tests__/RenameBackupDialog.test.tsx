import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RenameBackupDialog } from '#features/database/components/RenameBackupDialog';

describe('RenameBackupDialog', () => {
  it('saves a trimmed backup name and closes on success', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <RenameBackupDialog
        open
        initialName="old backup"
        onOpenChange={onOpenChange}
        onSave={onSave}
      />
    );

    const input = screen.getByLabelText('Backup Name');
    await user.clear(input);
    await user.type(input, ' new backup ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('new backup');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
