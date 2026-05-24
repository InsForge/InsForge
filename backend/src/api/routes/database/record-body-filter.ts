import { DatabaseRecord } from '@/types/database.js';

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
    if (columnTypeMap[key] !== 'text' && fieldValue === '') {
      continue;
    }
    filtered[key] = fieldValue;
  }

  return filtered;
}
