import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RealtimeMessagesPage from '#features/realtime/pages/RealtimeMessagesPage';

const { mockUseRealtimeMessages } = vi.hoisted(() => ({
  mockUseRealtimeMessages: vi.fn(),
}));

vi.mock('#assets/icons/refresh.svg?react', () => ({
  default: () => <svg aria-hidden="true" />,
}));

vi.mock('#features/realtime/hooks/useRealtimeMessages', () => ({
  useRealtimeMessages: () => mockUseRealtimeMessages(),
}));

function mockMessagesPageState(
  overrides: Partial<ReturnType<typeof mockUseRealtimeMessages>> = {}
) {
  mockUseRealtimeMessages.mockReturnValue({
    messages: [],
    messagesCount: 0,
    messagesParams: { limit: 100, offset: 0 },
    isLoadingMessages: false,
    messagesError: null,
    stats: undefined,
    isLoadingStats: false,
    messagesPageSize: 100,
    messagesCurrentPage: 1,
    messagesTotalCount: 0,
    messagesTotalPages: 1,
    setMessagesPage: vi.fn(),
    filterMessages: vi.fn(),
    clearMessages: vi.fn().mockResolvedValue({ deleted: 0 }),
    isClearingMessages: false,
    refetchMessages: vi.fn().mockResolvedValue(undefined),
    refetchStats: vi.fn().mockResolvedValue(undefined),
    refetch: vi.fn(),
    ...overrides,
  });
}

describe('RealtimeMessagesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms before clearing all realtime messages from the messages toolbar', async () => {
    const user = userEvent.setup();
    const clearMessages = vi.fn().mockResolvedValue({ deleted: 3 });
    mockMessagesPageState({ clearMessages });

    render(<RealtimeMessagesPage />);

    await user.click(screen.getByRole('button', { name: 'Clear messages' }));

    const confirmDialog = screen.getByRole('dialog', { name: 'Clear Realtime Messages' });
    expect(confirmDialog).toBeInTheDocument();
    expect(clearMessages).not.toHaveBeenCalled();

    await user.click(within(confirmDialog).getByRole('button', { name: 'Clear Messages' }));

    await waitFor(() => {
      expect(clearMessages).toHaveBeenCalledOnce();
    });
  });

  it('does not clear realtime messages when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const clearMessages = vi.fn().mockResolvedValue({ deleted: 3 });
    mockMessagesPageState({ clearMessages });

    render(<RealtimeMessagesPage />);

    await user.click(screen.getByRole('button', { name: 'Clear messages' }));

    const confirmDialog = screen.getByRole('dialog', { name: 'Clear Realtime Messages' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(confirmDialog).not.toBeInTheDocument();
    });
    expect(clearMessages).not.toHaveBeenCalled();
  });
});
