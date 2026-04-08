// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStorage } from '../useStorage';
import { createWrapper } from './test-utils';

// Mock storageService
vi.mock('../../services/storage.service', () => ({
  storageService: {
    listBuckets: vi.fn().mockResolvedValue([]),
    listObjects: vi.fn().mockResolvedValue({ objects: [], pagination: { offset: 0, limit: 20, total: 0 } }),
    createBucket: vi.fn(),
    deleteBucket: vi.fn(),
    editBucket: vi.fn(),
    uploadObject: vi.fn(),
    deleteObjects: vi.fn(),
    getDownloadUrl: vi.fn(),
    downloadObject: vi.fn(),
  },
}));

vi.mock('../../../../lib/hooks/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useStorage (facade)', () => {
  it('exposes all bucket hook keys', () => {
    const { result } = renderHook(() => useStorage(), { wrapper: createWrapper() });

    // Bucket keys
    expect(result.current).toHaveProperty('buckets');
    expect(result.current).toHaveProperty('bucketsCount');
    expect(result.current).toHaveProperty('isLoadingBuckets');
    expect(result.current).toHaveProperty('isCreatingBucket');
    expect(result.current).toHaveProperty('isEditingBucket');
    expect(result.current).toHaveProperty('isDeletingBucket');
    expect(result.current).toHaveProperty('bucketsError');
    expect(result.current).toHaveProperty('createBucket');
    expect(result.current).toHaveProperty('editBucket');
    expect(result.current).toHaveProperty('deleteBucket');
    expect(result.current).toHaveProperty('refetchBuckets');
    expect(result.current).toHaveProperty('useBucketStats');
  });

  it('exposes all object hook keys', () => {
    const { result } = renderHook(() => useStorage(), { wrapper: createWrapper() });

    // Object keys
    expect(result.current).toHaveProperty('isUploadingObject');
    expect(result.current).toHaveProperty('isDeletingObject');
    expect(result.current).toHaveProperty('uploadObject');
    expect(result.current).toHaveProperty('deleteObjects');
    expect(result.current).toHaveProperty('useListObjects');
    expect(result.current).toHaveProperty('getDownloadUrl');
    expect(result.current).toHaveProperty('downloadObject');
  });

  it('returns correct default values', () => {
    const { result } = renderHook(() => useStorage(), { wrapper: createWrapper() });

    expect(result.current.buckets).toEqual([]);
    expect(result.current.bucketsCount).toBe(0);
    expect(result.current.isUploadingObject).toBe(false);
    expect(result.current.isDeletingObject).toBe(false);
  });
});
