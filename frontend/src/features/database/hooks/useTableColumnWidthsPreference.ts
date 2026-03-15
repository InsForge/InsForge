import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'insforge.database.tables.preferences.v1';
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
  if (typeof window === 'undefined') {
    return createEmptyPreferences();
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return createEmptyPreferences();
    }

    const parsed = JSON.parse(stored) as unknown;
    return sanitizePreferences(parsed);
  } catch (error) {
    console.error('Failed to load database grid preferences from localStorage:', error);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore cleanup errors and keep UI functional.
    }
    return createEmptyPreferences();
  }
}

function savePreferences(preferences: DatabaseGridPreferences): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
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
  const hasMountedRef = useRef(false);

  useEffect(() => {
    latestPreferencesRef.current = preferences;

    // Skip persistence on first mount to avoid unnecessary localStorage writes.
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      savePreferences(latestPreferencesRef.current);
      saveTimeoutRef.current = null;
    }, STORAGE_SAVE_DEBOUNCE_MS);
  }, [preferences]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        savePreferences(latestPreferencesRef.current);
      }
    };
  }, []);

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

      setPreferences((previousPreferences) => {
        const currentWidths = previousPreferences.tableColumnWidths[tableName] ?? {};
        if (currentWidths[columnKey] === width) {
          return previousPreferences;
        }

        const nextWidths = filterWidthsByColumns(
          { ...currentWidths, [columnKey]: width },
          availableColumns
        );

        const nextPreferences: DatabaseGridPreferences = {
          tableColumnWidths: {
            ...previousPreferences.tableColumnWidths,
            [tableName]: nextWidths,
          },
        };

        return nextPreferences;
      });
    },
    [tableName, availableColumns]
  );

  return {
    columnWidths,
    setColumnWidth,
  };
}
