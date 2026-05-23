import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LOCAL_STORAGE_KEYS } from '#lib/utils/constants';
import {
  getLocalStorageJSON,
  removeLocalStorageItem,
  setLocalStorageJSON,
} from '#lib/utils/local-storage';
import { buildDatabaseTablePreferenceKey } from '#features/database/helpers';

const STORAGE_SAVE_DEBOUNCE_MS = 300;

export type TableColumnWidths = Record<string, number>;
export type TableColumnOrder = string[];

interface DatabaseGridPreferences {
  tableColumnWidths: Record<string, TableColumnWidths>;
  tableColumnOrders: Record<string, TableColumnOrder>;
}

function createEmptyPreferences(): DatabaseGridPreferences {
  return {
    tableColumnWidths: {},
    tableColumnOrders: {},
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
  if (!isRecord(value)) {
    return createEmptyPreferences();
  }

  const tableColumnWidths: Record<string, TableColumnWidths> = {};
  if (isRecord(value.tableColumnWidths)) {
    Object.entries(value.tableColumnWidths).forEach(([tableName, columnWidths]) => {
      tableColumnWidths[tableName] = sanitizeColumnWidths(columnWidths);
    });
  }

  const tableColumnOrders: Record<string, TableColumnOrder> = {};
  if (isRecord(value.tableColumnOrders)) {
    Object.entries(value.tableColumnOrders).forEach(([tableName, columnOrder]) => {
      tableColumnOrders[tableName] = sanitizeColumnOrder(columnOrder);
    });
  }

  return { tableColumnWidths, tableColumnOrders };
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

function sanitizeColumnOrder(value: unknown): TableColumnOrder {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenColumnKeys = new Set<string>();
  const sanitized: TableColumnOrder = [];

  value.forEach((columnKey) => {
    if (typeof columnKey !== 'string' || seenColumnKeys.has(columnKey)) {
      return;
    }

    seenColumnKeys.add(columnKey);
    sanitized.push(columnKey);
  });

  return sanitized;
}

function filterOrderByColumns(
  order: TableColumnOrder,
  availableColumns?: string[]
): TableColumnOrder {
  if (!availableColumns?.length) {
    return order;
  }

  const availableColumnSet = new Set(availableColumns);
  const filteredOrder = order.filter((columnKey) => availableColumnSet.has(columnKey));
  const orderedColumnSet = new Set(filteredOrder);
  const missingColumns = availableColumns.filter((columnKey) => !orderedColumnSet.has(columnKey));

  return [...filteredOrder, ...missingColumns];
}

function areColumnOrdersEqual(left: TableColumnOrder, right: TableColumnOrder): boolean {
  return (
    left.length === right.length && left.every((columnKey, index) => columnKey === right[index])
  );
}

function reorderColumnKeys(
  columnOrder: TableColumnOrder,
  sourceKey: string,
  targetKey: string
): TableColumnOrder {
  const nextOrder = [...columnOrder];
  const from = nextOrder.indexOf(sourceKey);
  const to = nextOrder.indexOf(targetKey);

  if (from === -1 || to === -1) {
    return columnOrder;
  }

  nextOrder.splice(from, 1);
  nextOrder.splice(to, 0, sourceKey);
  return nextOrder;
}

export function useTablePreferences(
  tableName: string | null,
  schemaName: string = 'public',
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
        tableColumnOrders: latestPreferencesRef.current.tableColumnOrders,
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

  const tableStorageKey = useMemo(() => {
    if (!tableName) {
      return null;
    }

    return buildDatabaseTablePreferenceKey(schemaName, tableName);
  }, [schemaName, tableName]);

  const columnWidths = useMemo(() => {
    if (!tableStorageKey) {
      return {};
    }

    const storedWidths = preferences.tableColumnWidths[tableStorageKey] ?? {};
    return filterWidthsByColumns(storedWidths, availableColumns);
  }, [tableStorageKey, availableColumns, preferences]);

  const columnOrder = useMemo(() => {
    if (!tableStorageKey) {
      return availableColumns ?? [];
    }

    const storedOrder = preferences.tableColumnOrders[tableStorageKey] ?? [];
    return filterOrderByColumns(storedOrder, availableColumns);
  }, [tableStorageKey, availableColumns, preferences]);

  const setColumnWidth = useCallback(
    (columnKey: string, width: number) => {
      if (!tableStorageKey || !columnKey || !Number.isFinite(width) || width <= 0) {
        return;
      }

      if (availableColumns?.length && !availableColumns.includes(columnKey)) {
        return;
      }

      const committedWidth =
        latestPreferencesRef.current.tableColumnWidths[tableStorageKey]?.[columnKey];
      const pendingWidth = pendingWidthsRef.current[tableStorageKey]?.[columnKey];

      if (committedWidth === width && pendingWidth === undefined) {
        return;
      }

      if (pendingWidth === width) {
        return;
      }

      const tablePendingWidths = pendingWidthsRef.current[tableStorageKey] ?? {};
      pendingWidthsRef.current = {
        ...pendingWidthsRef.current,
        [tableStorageKey]: {
          ...tablePendingWidths,
          [columnKey]: width,
        },
      };

      scheduleFlushPendingWidths();
    },
    [tableStorageKey, availableColumns, scheduleFlushPendingWidths]
  );

  const setColumnOrder = useCallback(
    (nextOrder: TableColumnOrder) => {
      if (!tableStorageKey) {
        return;
      }

      const filteredOrder = filterOrderByColumns(sanitizeColumnOrder(nextOrder), availableColumns);
      const committedOrder = latestPreferencesRef.current.tableColumnOrders[tableStorageKey] ?? [];

      if (
        areColumnOrdersEqual(filterOrderByColumns(committedOrder, availableColumns), filteredOrder)
      ) {
        return;
      }

      const nextPreferences: DatabaseGridPreferences = {
        ...latestPreferencesRef.current,
        tableColumnOrders: {
          ...latestPreferencesRef.current.tableColumnOrders,
          [tableStorageKey]: filteredOrder,
        },
      };

      latestPreferencesRef.current = nextPreferences;
      setPreferences(nextPreferences);
      savePreferences(nextPreferences);
    },
    [availableColumns, tableStorageKey]
  );

  const reorderColumns = useCallback(
    (sourceKey: string, targetKey: string) => {
      if (!tableStorageKey) {
        return;
      }

      const currentOrder = filterOrderByColumns(
        latestPreferencesRef.current.tableColumnOrders[tableStorageKey] ?? availableColumns ?? [],
        availableColumns
      );
      setColumnOrder(reorderColumnKeys(currentOrder, sourceKey, targetKey));
    },
    [availableColumns, setColumnOrder, tableStorageKey]
  );

  return {
    columnWidths,
    columnOrder,
    reorderColumns,
    setColumnWidth,
    setColumnOrder,
  };
}
