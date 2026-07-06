import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealtimeMessages } from '#features/realtime/hooks/useRealtimeMessages';
import { realtimeService } from '#features/realtime/services/realtime.service';

vi.mock('#features/realtime/services/realtime.service', () => ({
  realtimeService: {
    listMessages: vi.fn(),
    getMessageStats: vi.fn(),
    clearMessages: vi.fn(),
  },
}));

const toastMocks = vi.hoisted(() => ({
  showToast: vi.fn(),
}));

vi.mock('@insforge/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@insforge/ui')>();

  return {
    ...actual,
    useToast: () => ({
      showToast: toastMocks.showToast,
    }),
  };
});

const listMessagesMock = vi.mocked(realtimeService.listMessages);
const getMessageStatsMock = vi.mocked(realtimeService.getMessageStats);
const clearMessagesMock = vi.mocked(realtimeService.clearMessages);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useRealtimeMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastMocks.showToast.mockReset();
    listMessagesMock.mockResolvedValue([]);
    getMessageStatsMock.mockResolvedValue({
      totalMessages: 300,
      whDeliveryRate: 0,
      topEvents: [],
      retentionDays: null,
    });
    clearMessagesMock.mockResolvedValue({ deleted: 300 });
  });

  it('resets the messages page offset after clearing messages', async () => {
    const { result } = renderHook(() => useRealtimeMessages(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.messagesTotalCount).toBe(300);
    });

    act(() => {
      result.current.setMessagesPage(3);
    });

    expect(result.current.messagesParams.offset).toBe(200);

    await act(async () => {
      await result.current.clearMessages();
    });

    await waitFor(() => {
      expect(result.current.messagesParams.offset).toBe(0);
    });
    expect(clearMessagesMock).toHaveBeenCalledOnce();
  });
});
