import { useState, useCallback } from 'react';
import { LOCAL_STORAGE_KEY_PREFIXES } from '#lib/utils/constants';
import { getLocalStorageItem, setLocalStorageItem } from '#lib/utils/local-storage';

const PAGE_SIZE_OPTIONS = [50, 100, 250, 500];
const DEFAULT_PAGE_SIZE = 50;

function getStoredPageSize(storageKey: string): number {
  const stored = getLocalStorageItem(storageKey);
  if (stored) {
    const parsed = Number(stored);
    if (PAGE_SIZE_OPTIONS.includes(parsed)) {
      return parsed;
    }
  }

  return DEFAULT_PAGE_SIZE;
}

export function usePageSize(scope: string) {
  const storageKey = `${LOCAL_STORAGE_KEY_PREFIXES.pageSize}-${scope}`;
  const [pageSize, setPageSize] = useState(() => getStoredPageSize(storageKey));

  const handlePageSizeChange = useCallback(
    (newPageSize: number) => {
      if (!PAGE_SIZE_OPTIONS.includes(newPageSize)) {
        return;
      }
      setPageSize(newPageSize);
      setLocalStorageItem(storageKey, String(newPageSize));
    },
    [storageKey]
  );

  return {
    pageSize,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    onPageSizeChange: handlePageSizeChange,
  };
}
