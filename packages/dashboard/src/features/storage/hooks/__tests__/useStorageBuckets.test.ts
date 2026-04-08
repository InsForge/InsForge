// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useStorageBuckets } from '../useStorageBuckets';
import { createWrapper } from './test-utils';

// Mock storageService
const mockListBuckets = vi.fn();
const mockListObjects = vi.fn();
const mockCreateBucket = vi.fn();
const mockDeleteBucket = vi.fn();
const mockEditBucket = vi.fn();

vi.mock('../../services/storage.service', () => ({
  storageService: {
    listBuckets: (...args: unknown[]) => mockListBuckets(...args),
    listObjects: (...args: unknown[]) => mockListObjects(...args),
    createBucket: (...args: unknown[]) => mockCreateBucket(...args),
    deleteBucket: (...args: unknown[]) => mockDeleteBucket(...args),
    editBucket: (...args: unknown[]) => mockEditBucket(...args),
  },
}));

// Mock useToast
const mockShowToast = vi.fn();
vi.mock('../../../../lib/hooks/useToast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const fakeBuckets = [
  { name: 'photos', public: true, createdAt: '2025-01-01T00:00:00Z' },
  { name: 'docs', public: false, createdAt: '2025-02-01T00:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useStorageBuckets', () => {
  it('returns empty buckets by default while loading', () => {
    mockListBuckets.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useStorageBuckets(), { wrapper: createWrapper() });

    expect(result.current.buckets).toEqual([]);
    expect(result.current.bucketsCount).toBe(0);
    expect(result.current.isLoadingBuckets).toBe(true);
  });

  it('returns fetched buckets after loading', async () => {
    mockListBuckets.mockResolvedValue(fakeBuckets);
    const { result } = renderHook(() => useStorageBuckets(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoadingBuckets).toBe(false));

    expect(result.current.buckets).toEqual(fakeBuckets);
    expect(result.current.bucketsCount).toBe(2);
  });

  it('exposes bucketsError when the query fails', async () => {
    mockListBuckets.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useStorageBuckets(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.bucketsError).toBeTruthy());

    expect(result.current.buckets).toEqual([]);
  });

  describe('createBucket', () => {
    it('shows success toast and calls service', async () => {
      mockListBuckets.mockResolvedValue([]);
      mockCreateBucket.mockResolvedValue(undefined);
      const { result } = renderHook(() => useStorageBuckets(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isLoadingBuckets).toBe(false));
      await act(() => result.current.createBucket({ bucketName: 'new-bucket', isPublic: true }));

      expect(mockCreateBucket).toHaveBeenCalledWith('new-bucket', true);
      expect(mockShowToast).toHaveBeenCalledWith('Bucket created successfully', 'success');
    });

    it('shows error toast on failure', async () => {
      mockListBuckets.mockResolvedValue([]);
      mockCreateBucket.mockRejectedValue(new Error('Bucket already exists'));
      const { result } = renderHook(() => useStorageBuckets(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isLoadingBuckets).toBe(false));
      await act(async () => {
        await result.current.createBucket({ bucketName: 'dup', isPublic: false }).catch(() => {});
      });

      expect(mockShowToast).toHaveBeenCalledWith('Bucket already exists', 'error');
    });
  });

  describe('deleteBucket', () => {
    it('shows success toast on delete', async () => {
      mockListBuckets.mockResolvedValue(fakeBuckets);
      mockDeleteBucket.mockResolvedValue(undefined);
      const { result } = renderHook(() => useStorageBuckets(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isLoadingBuckets).toBe(false));
      await act(() => result.current.deleteBucket('photos'));

      expect(mockDeleteBucket).toHaveBeenCalledWith('photos');
      expect(mockShowToast).toHaveBeenCalledWith('Bucket deleted successfully', 'success');
    });

    it('shows error toast on failure', async () => {
      mockListBuckets.mockResolvedValue(fakeBuckets);
      mockDeleteBucket.mockRejectedValue(new Error('Bucket not empty'));
      const { result } = renderHook(() => useStorageBuckets(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isLoadingBuckets).toBe(false));
      await act(async () => {
        await result.current.deleteBucket('photos').catch(() => {});
      });

      expect(mockShowToast).toHaveBeenCalledWith('Bucket not empty', 'error');
    });
  });

  describe('editBucket', () => {
    it('shows success toast on edit', async () => {
      mockListBuckets.mockResolvedValue(fakeBuckets);
      mockEditBucket.mockResolvedValue(undefined);
      const { result } = renderHook(() => useStorageBuckets(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isLoadingBuckets).toBe(false));
      await act(() =>
        result.current.editBucket({ bucketName: 'photos', config: { isPublic: false } })
      );

      expect(mockEditBucket).toHaveBeenCalledWith('photos', { isPublic: false });
      expect(mockShowToast).toHaveBeenCalledWith('Bucket updated successfully', 'success');
    });

    it('shows error toast on failure', async () => {
      mockListBuckets.mockResolvedValue(fakeBuckets);
      mockEditBucket.mockRejectedValue(new Error('Permission denied'));
      const { result } = renderHook(() => useStorageBuckets(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isLoadingBuckets).toBe(false));
      await act(async () => {
        await result.current
          .editBucket({ bucketName: 'photos', config: { isPublic: false } })
          .catch(() => {});
      });

      expect(mockShowToast).toHaveBeenCalledWith('Permission denied', 'error');
    });
  });

  describe('useBucketStats', () => {
    it('aggregates stats from all buckets', async () => {
      mockListBuckets.mockResolvedValue(fakeBuckets);
      mockListObjects.mockImplementation((bucketName: string) => {
        const totals: Record<string, number> = { photos: 42, docs: 7 };
        return Promise.resolve({
          objects: [],
          pagination: { offset: 0, limit: 1, total: totals[bucketName] ?? 0 },
        });
      });

      const { result } = renderHook(
        () => {
          const bucketHook = useStorageBuckets();
          const statsHook = bucketHook.useBucketStats();
          return { bucketHook, statsHook };
        },
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.statsHook.data).toBeDefined());

      const stats = result.current.statsHook.data!;
      expect(stats.photos.fileCount).toBe(42);
      expect(stats.docs.fileCount).toBe(7);
      expect(stats.photos.public).toBe(true);
      expect(stats.docs.public).toBe(false);
    });

    it('returns zeroed stats when a bucket fetch fails', async () => {
      mockListBuckets.mockResolvedValue([fakeBuckets[0]]);
      mockListObjects.mockRejectedValue(new Error('timeout'));

      const { result } = renderHook(
        () => {
          const bucketHook = useStorageBuckets();
          const statsHook = bucketHook.useBucketStats();
          return { bucketHook, statsHook };
        },
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.statsHook.data).toBeDefined());

      const stats = result.current.statsHook.data!;
      expect(stats.photos.fileCount).toBe(0);
      expect(stats.photos.totalSize).toBe(0);
    });

    it('is disabled when no buckets exist', async () => {
      mockListBuckets.mockResolvedValue([]);
      mockListObjects.mockResolvedValue({ objects: [], pagination: { offset: 0, limit: 1, total: 0 } });

      const { result } = renderHook(
        () => {
          const bucketHook = useStorageBuckets();
          const statsHook = bucketHook.useBucketStats();
          return { bucketHook, statsHook };
        },
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.bucketHook.isLoadingBuckets).toBe(false));

      // stats query should never fire
      expect(mockListObjects).not.toHaveBeenCalled();
      expect(result.current.statsHook.data).toBeUndefined();
    });
  });
});
