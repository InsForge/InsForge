import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LOCAL_STORAGE_KEYS } from '#lib/utils/constants';
import {
  getLocalStorageJSON,
  removeLocalStorageItem,
  setLocalStorageJSON,
} from '#lib/utils/local-storage';

const STORAGE_SAVE_DEBOUNCE_MS = 300;

export type TableColumnWidths = Record<string, number>;

interface DatabaseGridPreferences {
  tableColumnWidths: Record<string, TableColumnWidths>;
}

function createEmptyPreferences(): DatabaseGridPreferences {
  return {
    tableColumnWidths: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeColumnWidths(value: unknown): TableColumnWidths {
  if (!isRecord(value)) {
    return {};
  }

  const sanitized: TableColumnWidths = {};
  Object.entries(value).forEach(([columnKey, width]) => {
    if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
      sanitized[columnKey] = width;
    }
  });

  return sanitized;
}

function sanitizePreferences(value: unknown): DatabaseGridPreferences {
  if (!isRecord(value) || !isRecord(value.tableColumnWidths)) {
    return createEmptyPreferences();
  }

  const tableColumnWidths: Record<string, TableColumnWidths> = {};
  Object.entries(value.tableColumnWidths).forEach(([tableName, columnWidths]) => {
    tableColumnWidths[tableName] = sanitizeColumnWidths(columnWidths);
  });

  return { tableColumnWidths };
}

function loadPreferences(): DatabaseGridPreferences {
  try {
    const parsed = getLocalStorageJSON<unknown>(LOCAL_STORAGE_KEYS.databaseTablePreferences);
    if (!parsed) {
      return createEmptyPreferences();
    }

    return sanitizePreferences(parsed);
  } catch (error) {
    console.error('Failed to load database grid preferences from localStorage:', error);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.databaseTablePreferences);
    return createEmptyPreferences();
  }
}

function savePreferences(preferences: DatabaseGridPreferences): void {
  try {
    setLocalStorageJSON(LOCAL_STORAGE_KEYS.databaseTablePreferences, preferences);
  } catch (error) {
    console.error('Failed to save database grid preferences to localStorage:', error);
  }
}

function filterWidthsByColumns(
  widths: TableColumnWidths,
  availableColumns?: string[]
): TableColumnWidths {
  if (!availableColumns?.length) {
    return widths;
  }

  const availableColumnSet = new Set(availableColumns);
  const filtered: TableColumnWidths = {};

  Object.entries(widths).forEach(([columnKey, width]) => {
    if (availableColumnSet.has(columnKey)) {
      filtered[columnKey] = width;
    }
  });

  return filtered;
}

export function useTableColumnWidthsPreference(
  tableName: string | null,
  availableColumns?: string[]
) {
  const [preferences, setPreferences] = useState<DatabaseGridPreferences>(loadPreferences);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPreferencesRef = useRef(preferences);
  const pendingWidthsRef = useRef<Record<string, TableColumnWidths>>({});

  useEffect(() => {
    latestPreferencesRef.current = preferences;
  }, [preferences]);

  const flushPendingWidths = useCallback(
    (skipStateUpdate: boolean = false) => {
      const pendingWidthsByTable = pendingWidthsRef.current;
      const tableEntries = Object.entries(pendingWidthsByTable);

      if (!tableEntries.length) {
        return;
      }

      pendingWidthsRef.current = {};

      let hasChanges = false;
      let nextTableColumnWidths = latestPreferencesRef.current.tableColumnWidths;

      tableEntries.forEach(([pendingTableName, pendingWidths]) => {
        if (!Object.keys(pendingWidths).length) {
          return;
        }

        const currentWidths = nextTableColumnWidths[pendingTableName] ?? {};
        let tableChanged = false;

        const mergedWidths: TableColumnWidths = { ...currentWidths };
        Object.entries(pendingWidths).forEach(([columnKey, width]) => {
          if (mergedWidths[columnKey] !== width) {
            mergedWidths[columnKey] = width;
            tableChanged = true;
          }
        });

        if (!tableChanged) {
          return;
        }

        if (!hasChanges) {
          nextTableColumnWidths = { ...nextTableColumnWidths };
          hasChanges = true;
        }

        nextTableColumnWidths[pendingTableName] = mergedWidths;
      });

      if (!hasChanges) {
        return;
      }

      const nextPreferences: DatabaseGridPreferences = {
        tableColumnWidths: nextTableColumnWidths,
      };
      latestPreferencesRef.current = nextPreferences;
      if (!skipStateUpdate) {
        setPreferences(nextPreferences);
      }
      savePreferences(nextPreferences);
    },
    [setPreferences]
  );

  const scheduleFlushPendingWidths = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      flushPendingWidths();
    }, STORAGE_SAVE_DEBOUNCE_MS);
  }, [flushPendingWidths]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      flushPendingWidths(true);
    };
  }, [flushPendingWidths]);

  const columnWidths = useMemo(() => {
    if (!tableName) {
      return {};
    }

    const storedWidths = preferences.tableColumnWidths[tableName] ?? {};
    return filterWidthsByColumns(storedWidths, availableColumns);
  }, [tableName, availableColumns, preferences]);

  const setColumnWidth = useCallback(
    (columnKey: string, width: number) => {
      if (!tableName || !columnKey || !Number.isFinite(width) || width <= 0) {
        return;
      }

      if (availableColumns?.length && !availableColumns.includes(columnKey)) {
        return;
      }

      const committedWidth = latestPreferencesRef.current.tableColumnWidths[tableName]?.[columnKey];
      const pendingWidth = pendingWidthsRef.current[tableName]?.[columnKey];

      if (committedWidth === width && pendingWidth === undefined) {
        return;
      }

      if (pendingWidth === width) {
        return;
      }

      const tablePendingWidths = pendingWidthsRef.current[tableName] ?? {};
      pendingWidthsRef.current = {
        ...pendingWidthsRef.current,
        [tableName]: {
          ...tablePendingWidths,
          [columnKey]: width,
        },
      };

      scheduleFlushPendingWidths();
    },
    [tableName, availableColumns, scheduleFlushPendingWidths]
  );

  return {
    columnWidths,
    setColumnWidth,
  };
}
