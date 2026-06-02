import { afterEach, describe, expect, it } from 'vitest';
import { ColumnType } from '@insforge/shared-schemas';
import {
  getTableFormCreateDraftStorageKey,
  hasRestorableTableFormCreateDraft,
} from '#features/database/components/TableForm';

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

  it('does not restore drafts written for another project with the same schema name', () => {
    const projectADraftKey = getTableFormCreateDraftStorageKey('project:project-a', 'public');
    if (!projectADraftKey) {
      throw new Error('Expected project draft key');
    }

    window.localStorage.setItem(projectADraftKey, createDraft('public'));

    expect(hasRestorableTableFormCreateDraft('public', 'project:project-a')).toBe(true);
    expect(hasRestorableTableFormCreateDraft('public', 'project:project-b')).toBe(false);
  });

  it('does not restore drafts written for another schema in the same project', () => {
    const publicDraftKey = getTableFormCreateDraftStorageKey('project:project-a', 'public');

    window.localStorage.setItem(publicDraftKey, createDraft('public'));

    expect(hasRestorableTableFormCreateDraft('public', 'project:project-a')).toBe(true);
    expect(hasRestorableTableFormCreateDraft('custom', 'project:project-a')).toBe(false);
  });

  it('ignores the legacy unscoped draft key', () => {
    window.localStorage.setItem('table-form-columns-draft', createDraft('public'));

    expect(hasRestorableTableFormCreateDraft('public', 'project:project-a')).toBe(false);
  });
});
