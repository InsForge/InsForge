import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { RealtimeMessage } from '#features/realtime/services/realtime.service';
import { MessageRow } from '#features/realtime/components/MessageRow';

const message: RealtimeMessage = {
  id: '11111111-1111-1111-1111-111111111111',
  eventName: 'user.created',
  channelId: null,
  channelName: 'public',
  payload: { hello: 'world' },
  senderType: 'user',
  senderId: null,
  wsAudienceCount: 3,
  whAudienceCount: 2,
  whDeliveredCount: 1,
  createdAt: '2026-06-15T10:00:00.000Z',
};

describe('MessageRow', () => {
  it('toggles the payload panel when the row is clicked', () => {
    render(<MessageRow message={message} />);

    // Collapsed by default — the payload panel (CodeBlock labeled "Payload") is absent.
    expect(screen.queryByText('Payload')).toBeNull();

    const row = screen.getByText('user.created');

    fireEvent.click(row);
    expect(screen.getByText('Payload')).toBeInTheDocument();

    fireEvent.click(row);
    expect(screen.queryByText('Payload')).toBeNull();
  });
});
