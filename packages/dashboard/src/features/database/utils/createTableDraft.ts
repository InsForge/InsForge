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

// Cloud serves every project from the same origin, so a schema name alone is not unique.
const getDraftKey = (projectId: string | undefined, schemaName: string) =>
  `${LOCAL_STORAGE_KEY_PREFIXES.createTableDraft}-${projectId ?? 'default'}-${schemaName}`;

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

export function loadCreateTableDraft(
  projectId: string | undefined,
  schemaName: string
): CreateTableDraft | null {
  const result = createTableDraftSchema.safeParse(
    getLocalStorageJSON(getDraftKey(projectId, schemaName))
  );
  return result.success && hasUserInput(result.data) ? result.data : null;
}

export function saveCreateTableDraft(
  projectId: string | undefined,
  schemaName: string,
  values: TableFormSchema,
  foreignKeys: TableFormForeignKeySchema[]
) {
  const key = getDraftKey(projectId, schemaName);
  const draft = { tableName: values.tableName, columns: values.columns, foreignKeys };

  if (hasUserInput(draft)) {
    setLocalStorageJSON(key, draft);
  } else {
    removeLocalStorageItem(key);
  }
}

export function clearCreateTableDraft(projectId: string | undefined, schemaName: string) {
  removeLocalStorageItem(getDraftKey(projectId, schemaName));
}
