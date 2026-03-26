import { useState, useCallback } from 'react';

const PAGE_SIZE_OPTIONS = [50, 100, 250, 500];
const DEFAULT_PAGE_SIZE = 50;
const STORAGE_KEY_PREFIX = 'insforge-page-size';

function getStoredPageSize(storageKey: string): number {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = Number(stored);
      if (PAGE_SIZE_OPTIONS.includes(parsed)) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn('Failed to read page size preference from localStorage', error);
  }
  return DEFAULT_PAGE_SIZE;
}

export function usePageSize(scope: string) {
  const storageKey = `${STORAGE_KEY_PREFIX}-${scope}`;
  const [pageSize, setPageSize] = useState(() => getStoredPageSize(storageKey));

  const handlePageSizeChange = useCallback(
    (newPageSize: number) => {
      if (!PAGE_SIZE_OPTIONS.includes(newPageSize)) {
        return;
      }
      setPageSize(newPageSize);
      try {
        localStorage.setItem(storageKey, String(newPageSize));
      } catch (error) {
        console.warn('Failed to persist page size preference', error);
      }
    },
    [storageKey]
  );

  return {
    pageSize,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    onPageSizeChange: handlePageSizeChange,
  };
}
