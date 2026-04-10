// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useStorageObjects } from '../useStorageObjects';
import { createWrapper } from './test-utils';

// Mock storageService
const mockListObjects = vi.fn();
const mockUploadObject = vi.fn();
const mockDeleteObjects = vi.fn();
const mockGetDownloadUrl = vi.fn(
  (bucket: string, key: string) => `/api/storage/buckets/${bucket}/objects/${key}`
);
const mockDownloadObject = vi.fn();

vi.mock('../../services/storage.service', () => ({
  storageService: {
    listObjects: (...args: any[]) => mockListObjects(...args),
    uploadObject: (...args: any[]) => mockUploadObject(...args),
    deleteObjects: (...args: any[]) => mockDeleteObjects(...args),
    getDownloadUrl: (...args: any[]) => mockGetDownloadUrl(...args),
    downloadObject: (...args: any[]) => mockDownloadObject(...args),
  },
}));

// Mock useToast
const mockShowToast = vi.fn();
vi.mock('../../../../lib/hooks/useToast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useStorageObjects', () => {
  it('returns initial state with no pending operations', () => {
    const { result } = renderHook(() => useStorageObjects(), { wrapper: createWrapper() });

    expect(result.current.isUploadingObject).toBe(false);
    expect(result.current.isDeletingObject).toBe(false);
    expect(typeof result.current.uploadObject).toBe('function');
    expect(typeof result.current.deleteObjects).toBe('function');
    expect(typeof result.current.useListObjects).toBe('function');
    expect(typeof result.current.getDownloadUrl).toBe('function');
    expect(typeof result.current.downloadObject).toBe('function');
  });

  describe('useListObjects', () => {
    it('fetches objects for a given bucket', async () => {
      const mockResponse = {
        objects: [{ key: 'file.txt', size: 100 }],
        pagination: { offset: 0, limit: 20, total: 1 },
      };
      mockListObjects.mockResolvedValue(mockResponse);

      const { result } = renderHook(
        () => {
          const objectHook = useStorageObjects();
          const listHook = objectHook.useListObjects('my-bucket', { limit: 20, offset: 0 });
          return { objectHook, listHook };
        },
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.listHook.data).toBeDefined());

      expect(mockListObjects).toHaveBeenCalledWith(
        'my-bucket',
        { limit: 20, offset: 0 },
        undefined
      );
      expect(result.current.listHook.data).toEqual(mockResponse);
    });

    it('does not fetch when bucketName is empty', async () => {
      const { result } = renderHook(
        () => {
          const objectHook = useStorageObjects();
          const listHook = objectHook.useListObjects('');
          return { objectHook, listHook };
        },
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(mockListObjects).not.toHaveBeenCalled();
        expect(result.current.listHook.data).toBeUndefined();
      });
    });

    it('does not fetch when enabled is false', async () => {
      const { result } = renderHook(
        () => {
          const objectHook = useStorageObjects();
          const listHook = objectHook.useListObjects('my-bucket', undefined, undefined, false);
          return { objectHook, listHook };
        },
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(mockListObjects).not.toHaveBeenCalled();
        expect(result.current.listHook.data).toBeUndefined();
      });
    });

    it('passes search query to service', async () => {
      mockListObjects.mockResolvedValue({
        objects: [],
        pagination: { offset: 0, limit: 20, total: 0 },
      });

      renderHook(
        () => {
          const objectHook = useStorageObjects();
          return objectHook.useListObjects('my-bucket', { limit: 20 }, 'report');
        },
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(mockListObjects).toHaveBeenCalled());
      expect(mockListObjects).toHaveBeenCalledWith('my-bucket', { limit: 20 }, 'report');
    });
  });

  describe('deleteObjects', () => {
    it('shows success toast when all deletes succeed', async () => {
      mockDeleteObjects.mockResolvedValue({
        success: ['a.txt', 'b.txt'],
        failures: [],
      });

      const { result } = renderHook(() => useStorageObjects(), { wrapper: createWrapper() });

      act(() => {
        result.current.deleteObjects({ bucket: 'photos', keys: ['a.txt', 'b.txt'] });
      });

      await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
      expect(mockShowToast).toHaveBeenCalledWith('2 files deleted successfully.', 'success');
    });

    it('shows singular message for single file delete', async () => {
      mockDeleteObjects.mockResolvedValue({
        success: ['a.txt'],
        failures: [],
      });

      const { result } = renderHook(() => useStorageObjects(), { wrapper: createWrapper() });

      act(() => {
        result.current.deleteObjects({ bucket: 'photos', keys: ['a.txt'] });
      });

      await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
      expect(mockShowToast).toHaveBeenCalledWith('1 file deleted successfully.', 'success');
    });

    it('shows warning toast for partial failures', async () => {
      mockDeleteObjects.mockResolvedValue({
        success: ['a.txt'],
        failures: [{ key: 'b.txt', error: new Error('not found') }],
      });

      const { result } = renderHook(() => useStorageObjects(), { wrapper: createWrapper() });

      act(() => {
        result.current.deleteObjects({ bucket: 'photos', keys: ['a.txt', 'b.txt'] });
      });

      await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
      expect(mockShowToast).toHaveBeenCalledWith(
        '1 file deleted, 1 file failed to delete.',
        'warn'
      );
    });

    it('shows error toast when all deletes fail', async () => {
      mockDeleteObjects.mockResolvedValue({
        success: [],
        failures: [
          { key: 'a.txt', error: new Error('denied') },
          { key: 'b.txt', error: new Error('denied') },
        ],
      });

      const { result } = renderHook(() => useStorageObjects(), { wrapper: createWrapper() });

      act(() => {
        result.current.deleteObjects({ bucket: 'photos', keys: ['a.txt', 'b.txt'] });
      });

      await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
      expect(mockShowToast).toHaveBeenCalledWith('Failed to delete 2 files', 'error');
    });

    it('shows error toast when mutation itself throws', async () => {
      mockDeleteObjects.mockRejectedValue(new Error('Network failure'));

      const { result } = renderHook(() => useStorageObjects(), { wrapper: createWrapper() });

      act(() => {
        result.current.deleteObjects({ bucket: 'photos', keys: ['a.txt'] });
      });

      await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
      expect(mockShowToast).toHaveBeenCalledWith('Network failure', 'error');
    });
  });

  describe('uploadObject', () => {
    it('calls service with correct args', async () => {
      mockUploadObject.mockResolvedValue({ key: 'file.txt' });
      const file = new File(['content'], 'file.txt', { type: 'text/plain' });

      const { result } = renderHook(() => useStorageObjects(), { wrapper: createWrapper() });

      await act(() =>
        result.current.uploadObject({ bucket: 'photos', objectKey: 'file.txt', file })
      );

      expect(mockUploadObject).toHaveBeenCalledWith('photos', 'file.txt', file);
    });
  });

  describe('getDownloadUrl', () => {
    it('delegates to storageService.getDownloadUrl', () => {
      const { result } = renderHook(() => useStorageObjects(), { wrapper: createWrapper() });

      const url = result.current.getDownloadUrl('my-bucket', 'photo.jpg');
      expect(url).toBe('/api/storage/buckets/my-bucket/objects/photo.jpg');
    });
  });
});
