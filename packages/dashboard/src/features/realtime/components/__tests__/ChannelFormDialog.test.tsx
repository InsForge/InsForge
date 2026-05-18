import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChannelFormDialog } from '#features/realtime/components/ChannelFormDialog';
import type { RealtimeChannel } from '@insforge/shared-schemas';

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

  it('saves only changed edit-mode fields', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const channel: RealtimeChannel = {
      id: '11111111-1111-1111-1111-111111111111',
      pattern: 'room:%',
      description: 'Room updates',
      enabled: true,
      webhookUrls: ['https://old.example.com/webhook'],
      createdAt: '2026-05-17T12:00:00.000Z',
      updatedAt: '2026-05-17T12:00:00.000Z',
    };

    render(
      <ChannelFormDialog
        mode="edit"
        open
        channel={channel}
        onOpenChange={vi.fn()}
        onSave={onSave}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('room:%')).toBeTruthy();
      expect(screen.getByDisplayValue('https://old.example.com/webhook')).toBeTruthy();
    });

    const description = screen.getByLabelText('Description');
    await user.clear(description);
    await user.type(description, 'Updated room updates');

    const webhookUrl = screen.getByPlaceholderText(
      'https://example.com/webhook'
    ) as HTMLInputElement;
    await user.clear(webhookUrl);
    await user.type(webhookUrl, 'https://new.example.com/webhook');

    await user.click(screen.getByRole('switch', { name: 'Enabled' }));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(channel.id, {
        description: 'Updated room updates',
        enabled: false,
        webhookUrls: ['https://new.example.com/webhook'],
      });
    });
  });
});
