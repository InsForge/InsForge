import { DatabaseRecord } from '@/types/database.js';

const TEXT_LIKE_COLUMN_TYPES = new Set(['text', 'character varying', 'character', 'citext']);

function isTextLikeColumnType(columnType: string | undefined): boolean {
  return columnType === undefined || TEXT_LIKE_COLUMN_TYPES.has(columnType);
}

export function filterEmptyStringsForColumnTypes(
  value: unknown,
  columnTypeMap: Record<string, string | undefined>
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => filterEmptyStringsForColumnTypes(item, columnTypeMap));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const filtered: DatabaseRecord = {};
  for (const [key, fieldValue] of Object.entries(value as DatabaseRecord)) {
    if (!isTextLikeColumnType(columnTypeMap[key]) && fieldValue === '') {
      continue;
    }
    filtered[key] = fieldValue;
  }

  return filtered;
}
