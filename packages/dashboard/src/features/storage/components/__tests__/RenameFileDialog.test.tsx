import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RenameFileDialog } from '#features/storage/components/RenameFileDialog';

describe('RenameFileDialog', () => {
  it('saves a trimmed file name and closes on success', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <RenameFileDialog open initialName="old.png" onOpenChange={onOpenChange} onSave={onSave} />
    );

    const input = screen.getByLabelText('File Name');
    await user.clear(input);
    await user.type(input, ' new.png ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('new.png');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
