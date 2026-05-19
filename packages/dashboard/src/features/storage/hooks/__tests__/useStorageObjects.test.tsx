import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStorageObjects } from '#features/storage/hooks/useStorageObjects';
import { storageService } from '#features/storage/services/storage.service';

const toastMocks = vi.hoisted(() => ({
  showToast: vi.fn(),
}));

vi.mock('#lib/hooks/useToast', () => ({
  useToast: () => ({
    showToast: toastMocks.showToast,
  }),
}));

vi.mock('#features/storage/services/storage.service', () => ({
  storageService: {
    listObjects: vi.fn(),
    uploadObject: vi.fn(),
    deleteObjects: vi.fn(),
    getDownloadUrl: vi.fn(),
    downloadObject: vi.fn(),
  },
}));

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useStorageObjects', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates bucket object and bucket stats queries after upload success', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(storageService.uploadObject).mockResolvedValue({
      bucket: 'logs',
      key: 'events.txt',
      size: 4,
      mimeType: 'text/plain',
      uploadedAt: new Date().toISOString(),
      url: '/api/storage/buckets/logs/objects/events.txt',
    });

    const { result } = renderHook(() => useStorageObjects(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.uploadObject({
        bucket: 'logs',
        objectKey: 'events.txt',
        file: new File(['test'], 'events.txt', { type: 'text/plain' }),
      });
    });

    await waitFor(() => {
      expect(storageService.uploadObject).toHaveBeenCalled();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['storage', 'objects', 'logs'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['storage', 'bucket-stats'] });
  });

  it('invalidates bucket object and bucket stats queries after delete success', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(storageService.deleteObjects).mockResolvedValue({
      success: ['events.txt'],
      failures: [],
    });

    const { result } = renderHook(() => useStorageObjects(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.deleteObjects({
        bucket: 'logs',
        keys: ['events.txt'],
      });
    });

    await waitFor(() => {
      expect(storageService.deleteObjects).toHaveBeenCalledWith('logs', ['events.txt']);
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['storage', 'objects', 'logs'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['storage', 'bucket-stats'] });
  });
});
