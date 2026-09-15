import { z } from 'zod';
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

const getDraftKey = (schemaName: string) =>
  `${LOCAL_STORAGE_KEY_PREFIXES.createTableDraft}-${schemaName}`;

// The untouched form (system columns plus one empty row) is not worth restoring.
const hasUserInput = (draft: CreateTableDraft) =>
  draft.tableName.trim() !== '' ||
  draft.foreignKeys.length > 0 ||
  draft.columns.some((column) => !column.isSystemColumn && column.columnName.trim() !== '');

export function loadCreateTableDraft(schemaName: string): CreateTableDraft | null {
  const result = createTableDraftSchema.safeParse(getLocalStorageJSON(getDraftKey(schemaName)));
  return result.success && hasUserInput(result.data) ? result.data : null;
}

export function saveCreateTableDraft(
  schemaName: string,
  values: TableFormSchema,
  foreignKeys: TableFormForeignKeySchema[]
) {
  const draft = { tableName: values.tableName, columns: values.columns, foreignKeys };

  if (hasUserInput(draft)) {
    setLocalStorageJSON(getDraftKey(schemaName), draft);
  } else {
    removeLocalStorageItem(getDraftKey(schemaName));
  }
}

export function clearCreateTableDraft(schemaName: string) {
  removeLocalStorageItem(getDraftKey(schemaName));
}
