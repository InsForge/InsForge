import { useState, useCallback, useEffect } from 'react';

export function useColumnOrder(storageKey: string, defaultKeys: string[]) {
  const buildOrder = useCallback((): string[] => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        const valid = parsed.filter((k) => defaultKeys.includes(k));
        const missing = defaultKeys.filter((k) => !parsed.includes(k));
        return [...valid, ...missing];
      }
    } catch (error) {
      console.warn('Failed to read column order from storage', error);
    }
    return defaultKeys;
  }, [storageKey, defaultKeys]);

  const [columnKeys, setColumnKeys] = useState<string[]>(buildOrder);

  useEffect(() => {
    setColumnKeys(buildOrder());
  }, [buildOrder]);

  const reorderColumns = useCallback(
    (sourceKey: string, targetKey: string) => {
      setColumnKeys((prev: string[]) => {
        const next = [...prev];
        const from = next.indexOf(sourceKey);
        const to = next.indexOf(targetKey);
        if (from === -1 || to === -1) {
          return prev;
        }
        next.splice(from, 1);
        const adjustedTo = from < to ? to - 1 : to;
        next.splice(adjustedTo, 0, sourceKey);
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch (error) {
          console.warn('Failed to persist column order', error);
        }
        return next;
      });
    },
    [storageKey]
  );

  return { columnKeys, reorderColumns };
}
