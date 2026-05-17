import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChannelFormDialog } from '#features/realtime/components/ChannelFormDialog';

describe('ChannelFormDialog', () => {
  it('creates a channel and filters empty webhook URLs', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    render(<ChannelFormDialog mode="create" open onOpenChange={vi.fn()} onCreate={onCreate} />);

    await user.type(screen.getByLabelText('Pattern'), 'room:%');
    await user.type(screen.getByLabelText('Description'), 'Room updates');
    await user.click(screen.getByRole('button', { name: 'Create Channel' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        pattern: 'room:%',
        enabled: true,
        description: 'Room updates',
        webhookUrls: undefined,
      });
    });
  });
});
