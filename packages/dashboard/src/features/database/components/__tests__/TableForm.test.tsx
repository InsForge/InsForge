import { afterEach, describe, expect, it } from 'vitest';
import { ColumnType } from '@insforge/shared-schemas';
import { getTableFormCreateDraftStorageKey } from '#features/database/components/TableForm';

const createDraft = (schemaName: string) =>
  JSON.stringify({
    schemaName,
    tableName: 'contacts',
    columns: [
      {
        columnName: 'name',
        type: ColumnType.STRING,
        defaultValue: '',
        isNullable: true,
        isUnique: false,
        isSystemColumn: false,
        isNewColumn: true,
      },
    ],
    foreignKeys: [],
  });

describe('TableForm draft storage', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('builds separate keys for separate draft scopes and schemas', () => {
    expect(getTableFormCreateDraftStorageKey('project:project-a', 'public')).toBe(
      'table-form-columns-draft:project%3Aproject-a:public'
    );
    expect(getTableFormCreateDraftStorageKey('project:project-a', 'public')).not.toBe(
      getTableFormCreateDraftStorageKey('project:project-b', 'public')
    );
    expect(getTableFormCreateDraftStorageKey('project:project-a', 'public')).not.toBe(
      getTableFormCreateDraftStorageKey('project:project-a', 'custom')
    );
  });
});
