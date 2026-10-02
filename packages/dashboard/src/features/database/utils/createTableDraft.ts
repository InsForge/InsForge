import { z } from 'zod';
import { ColumnType } from '@insforge/shared-schemas';
import {
  tableFormColumnSchema,
  tableFormForeignKeySchema,
  type TableFormForeignKeySchema,
  type TableFormSchema,
} from '#features/database/schema';
import { LOCAL_STORAGE_KEY_PREFIXES } from '#lib/utils/constants';
import {
  getLocalStorageJSON,
  removeLocalStorageItem,
  setLocalStorageJSON,
} from '#lib/utils/local-storage';

const createTableDraftSchema = z.object({
  tableName: z.string(),
  // A newly added column row can be saved before it has a name.
  columns: z.array(tableFormColumnSchema.extend({ columnName: z.string() })).min(1),
  foreignKeys: z.array(tableFormForeignKeySchema),
});

export type CreateTableDraft = z.infer<typeof createTableDraftSchema>;

// `scope` keeps projects that share an origin apart. Both parts are encoded, so neither
// can contain the separator.
const getDraftKey = (scope: string, schemaName: string) =>
  `${LOCAL_STORAGE_KEY_PREFIXES.createTableDraft}:${encodeURIComponent(scope)}:${encodeURIComponent(schemaName)}`;

// A row the form added that nobody has touched: no name and every setting at its default.
const isUntouchedColumn = (column: CreateTableDraft['columns'][number]) =>
  column.columnName.trim() === '' &&
  column.type === ColumnType.STRING &&
  !column.defaultValue &&
  column.isNullable &&
  !column.isUnique;

// The untouched form (system columns plus one empty row) is not worth restoring.
const hasUserInput = (draft: CreateTableDraft) =>
  draft.tableName.trim() !== '' ||
  draft.foreignKeys.length > 0 ||
  draft.columns.some((column) => !column.isSystemColumn && !isUntouchedColumn(column));

export const hasCreateTableInput = (
  values: TableFormSchema,
  foreignKeys: TableFormForeignKeySchema[]
) => hasUserInput({ tableName: values.tableName, columns: values.columns, foreignKeys });

export function loadCreateTableDraft(scope: string, schemaName: string): CreateTableDraft | null {
  const result = createTableDraftSchema.safeParse(
    getLocalStorageJSON(getDraftKey(scope, schemaName))
  );
  return result.success && hasUserInput(result.data) ? result.data : null;
}

// Returns false when the browser refused the write. The older draft is removed then, so a
// refresh cannot restore input that no longer matches the form.
export function saveCreateTableDraft(
  scope: string,
  schemaName: string,
  values: TableFormSchema,
  foreignKeys: TableFormForeignKeySchema[]
): boolean {
  const key = getDraftKey(scope, schemaName);

  if (!hasCreateTableInput(values, foreignKeys)) {
    return removeLocalStorageItem(key);
  }

  const draft = { tableName: values.tableName, columns: values.columns, foreignKeys };
  if (setLocalStorageJSON(key, draft)) {
    return true;
  }

  removeLocalStorageItem(key);
  return false;
}

export function clearCreateTableDraft(scope: string, schemaName: string) {
  removeLocalStorageItem(getDraftKey(scope, schemaName));
}
