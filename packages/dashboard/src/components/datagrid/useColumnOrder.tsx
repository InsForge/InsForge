// @ts-nocheck
import { useState, useCallback } from 'react';

export function useColumnOrder(storageKey: string, defaultKeys: string[]) {
  const [columnKeys, setColumnKeys] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        const valid = parsed.filter((k) => defaultKeys.includes(k));
        const missing = defaultKeys.filter((k) => !parsed.includes(k));
        return [...valid, ...missing];
      }
    } catch {
      // fall through
    }
    return defaultKeys;
  });

  const reorderColumns = useCallback(
    (sourceKey: string, targetKey: string) => {
      setColumnKeys((prev: string[]) => {
        const next = [...prev];
        const from = next.indexOf(sourceKey);
        const to = next.indexOf(targetKey);
        if (from === -1 || to === -1) return prev;
        next.splice(from, 1);
        next.splice(to, 0, sourceKey);
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch (_) {}
        return next;
      });
    },
    [storageKey]
  );

  return { columnKeys, reorderColumns };
}
