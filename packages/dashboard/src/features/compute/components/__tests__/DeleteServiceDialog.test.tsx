import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeleteServiceDialog } from '#features/compute/components/DeleteServiceDialog';

describe('DeleteServiceDialog', () => {
  it('requires typing the service name before confirming deletion', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <DeleteServiceDialog
        open
        onOpenChange={onOpenChange}
        serviceName="api-worker"
        onConfirm={onConfirm}
      />
    );

    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByLabelText(/Type api-worker to confirm/i), 'api-worker');
    expect((deleteButton as HTMLButtonElement).disabled).toBe(false);

    await user.click(deleteButton);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
