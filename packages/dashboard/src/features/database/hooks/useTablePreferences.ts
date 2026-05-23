import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LOCAL_STORAGE_KEYS } from '#lib/utils/constants';
import {
  getLocalStorageJSON,
  removeLocalStorageItem,
  setLocalStorageJSON,
} from '#lib/utils/local-storage';

const STORAGE_SAVE_DEBOUNCE_MS = 300;

export type TableColumnWidths = Record<string, number>;
export type TableColumnOrder = string[];

interface StoredTablePreferences {
  columnWidths: TableColumnWidths;
  columnOrder: TableColumnOrder;
}

interface StoredDatabasePreferences {
  tables: Record<string, Record<string, StoredTablePreferences>>;
}

function createEmptyTablePreferences(): StoredTablePreferences {
  return {
    columnWidths: {},
    columnOrder: [],
  };
}

function createEmptyPreferences(): StoredDatabasePreferences {
  return {
    tables: {},
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

function sanitizeStoredTablePreferences(value: unknown): StoredTablePreferences {
  if (!isRecord(value)) {
    return createEmptyTablePreferences();
  }

  return {
    columnWidths: sanitizeColumnWidths(value.columnWidths),
    columnOrder: sanitizeColumnOrder(value.columnOrder),
  };
}

function setStoredTablePreferences(
  preferences: StoredDatabasePreferences,
  schemaName: string,
  tableName: string,
  tablePreferences: Partial<StoredTablePreferences>
): void {
  const currentSchemaPreferences = preferences.tables[schemaName] ?? {};
  const currentTablePreferences =
    currentSchemaPreferences[tableName] ?? createEmptyTablePreferences();
  preferences.tables[schemaName] = {
    ...currentSchemaPreferences,
    [tableName]: {
      ...currentTablePreferences,
      ...tablePreferences,
    },
  };
}

function sanitizePreferences(value: unknown): StoredDatabasePreferences {
  if (!isRecord(value) || !isRecord(value.tables)) {
    return createEmptyPreferences();
  }

  const preferences = createEmptyPreferences();

  Object.entries(value.tables).forEach(([schemaName, tables]) => {
    if (!isRecord(tables)) {
      return;
    }

    Object.entries(tables).forEach(([tableName, tablePreferences]) => {
      setStoredTablePreferences(
        preferences,
        schemaName,
        tableName,
        sanitizeStoredTablePreferences(tablePreferences)
      );
    });
  });

  return preferences;
}

function loadPreferences(): StoredDatabasePreferences {
  try {
    const parsed = getLocalStorageJSON<unknown>(LOCAL_STORAGE_KEYS.databaseTablePreferences);
    if (!parsed) {
      return createEmptyPreferences();
    }

    return sanitizePreferences(parsed);
  } catch (error) {
    console.error('Failed to load database table preferences from localStorage:', error);
    removeLocalStorageItem(LOCAL_STORAGE_KEYS.databaseTablePreferences);
    return createEmptyPreferences();
  }
}

function savePreferences(preferences: StoredDatabasePreferences): void {
  try {
    setLocalStorageJSON(LOCAL_STORAGE_KEYS.databaseTablePreferences, preferences);
  } catch (error) {
    console.error('Failed to save database table preferences to localStorage:', error);
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

function getStoredTablePreferences(
  preferences: StoredDatabasePreferences,
  schemaName: string,
  tableName: string
): StoredTablePreferences {
  return preferences.tables[schemaName]?.[tableName] ?? createEmptyTablePreferences();
}

export function useTablePreferences(
  tableName: string | null,
  schemaName: string = 'public',
  availableColumns?: string[]
) {
  const [preferences, setPreferences] = useState<StoredDatabasePreferences>(loadPreferences);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPreferencesRef = useRef(preferences);
  const pendingWidthsRef = useRef<Record<string, Record<string, TableColumnWidths>>>({});

  useEffect(() => {
    latestPreferencesRef.current = preferences;
  }, [preferences]);

  const flushPendingWidths = useCallback(
    (skipStateUpdate: boolean = false) => {
      const pendingWidthsBySchema = pendingWidthsRef.current;
      const schemaEntries = Object.entries(pendingWidthsBySchema);

      if (!schemaEntries.length) {
        return;
      }

      pendingWidthsRef.current = {};

      let hasChanges = false;
      let nextTables = latestPreferencesRef.current.tables;

      schemaEntries.forEach(([pendingSchemaName, pendingTables]) => {
        const tableEntries = Object.entries(pendingTables);
        if (!tableEntries.length) {
          return;
        }

        tableEntries.forEach(([pendingTableName, pendingWidths]) => {
          if (!Object.keys(pendingWidths).length) {
            return;
          }

          const currentTablePreferences =
            nextTables[pendingSchemaName]?.[pendingTableName] ?? createEmptyTablePreferences();
          let tableChanged = false;

          const mergedWidths: TableColumnWidths = { ...currentTablePreferences.columnWidths };
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
            nextTables = { ...nextTables };
            hasChanges = true;
          }

          nextTables[pendingSchemaName] = {
            ...(nextTables[pendingSchemaName] ?? {}),
            [pendingTableName]: {
              ...currentTablePreferences,
              columnWidths: mergedWidths,
            },
          };
        });
      });

      if (!hasChanges) {
        return;
      }

      const nextPreferences: StoredDatabasePreferences = {
        tables: nextTables,
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

    const storedTablePreferences = getStoredTablePreferences(preferences, schemaName, tableName);
    return filterWidthsByColumns(storedTablePreferences.columnWidths, availableColumns);
  }, [schemaName, tableName, availableColumns, preferences]);

  const columnOrder = useMemo(() => {
    if (!tableName) {
      return availableColumns ?? [];
    }

    const storedTablePreferences = getStoredTablePreferences(preferences, schemaName, tableName);
    return filterOrderByColumns(storedTablePreferences.columnOrder, availableColumns);
  }, [schemaName, tableName, availableColumns, preferences]);

  const setColumnWidth = useCallback(
    (columnKey: string, width: number) => {
      if (!tableName || !columnKey || !Number.isFinite(width) || width <= 0) {
        return;
      }

      if (availableColumns?.length && !availableColumns.includes(columnKey)) {
        return;
      }

      const committedWidth =
        latestPreferencesRef.current.tables[schemaName]?.[tableName]?.columnWidths?.[columnKey];
      const pendingWidth = pendingWidthsRef.current[schemaName]?.[tableName]?.[columnKey];

      if (committedWidth === width && pendingWidth === undefined) {
        return;
      }

      if (pendingWidth === width) {
        return;
      }

      const schemaPendingWidths = pendingWidthsRef.current[schemaName] ?? {};
      const tablePendingWidths = schemaPendingWidths[tableName] ?? {};
      pendingWidthsRef.current = {
        ...pendingWidthsRef.current,
        [schemaName]: {
          ...schemaPendingWidths,
          [tableName]: {
            ...tablePendingWidths,
            [columnKey]: width,
          },
        },
      };

      scheduleFlushPendingWidths();
    },
    [schemaName, tableName, availableColumns, scheduleFlushPendingWidths]
  );

  const setColumnOrder = useCallback(
    (nextOrder: TableColumnOrder) => {
      if (!tableName) {
        return;
      }

      const filteredOrder = filterOrderByColumns(sanitizeColumnOrder(nextOrder), availableColumns);
      const currentTablePreferences = getStoredTablePreferences(
        latestPreferencesRef.current,
        schemaName,
        tableName
      );
      const committedOrder = currentTablePreferences.columnOrder;

      if (
        areColumnOrdersEqual(filterOrderByColumns(committedOrder, availableColumns), filteredOrder)
      ) {
        return;
      }

      const nextPreferences: StoredDatabasePreferences = {
        ...latestPreferencesRef.current,
        tables: {
          ...latestPreferencesRef.current.tables,
          [schemaName]: {
            ...(latestPreferencesRef.current.tables[schemaName] ?? {}),
            [tableName]: {
              ...currentTablePreferences,
              columnOrder: filteredOrder,
            },
          },
        },
      };

      latestPreferencesRef.current = nextPreferences;
      setPreferences(nextPreferences);
      savePreferences(nextPreferences);
    },
    [availableColumns, schemaName, tableName]
  );

  const reorderColumns = useCallback(
    (sourceKey: string, targetKey: string) => {
      if (!tableName) {
        return;
      }

      const currentTablePreferences = getStoredTablePreferences(
        latestPreferencesRef.current,
        schemaName,
        tableName
      );
      const currentOrder = filterOrderByColumns(
        currentTablePreferences.columnOrder,
        availableColumns
      );
      setColumnOrder(reorderColumnKeys(currentOrder, sourceKey, targetKey));
    },
    [availableColumns, schemaName, setColumnOrder, tableName]
  );

  return {
    columnWidths,
    columnOrder,
    reorderColumns,
    setColumnWidth,
    setColumnOrder,
  };
}
