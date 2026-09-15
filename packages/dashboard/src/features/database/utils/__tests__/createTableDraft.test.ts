import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColumnType } from '@insforge/shared-schemas';
import type { TableFormColumnSchema, TableFormForeignKeySchema } from '#features/database/schema';
import { LOCAL_STORAGE_KEY_PREFIXES } from '#lib/utils/constants';
import {
  clearCreateTableDraft,
  hasCreateTableInput,
  loadCreateTableDraft,
  saveCreateTableDraft,
} from '#features/database/utils/createTableDraft';

const SCOPE = 'project-1';

const idColumn: TableFormColumnSchema = {
  columnName: 'id',
  type: ColumnType.UUID,
  defaultValue: 'gen_random_uuid()',
  isPrimaryKey: true,
  isNullable: false,
  isUnique: true,
  isSystemColumn: true,
  isNewColumn: false,
};

const newColumn = (columnName: string): TableFormColumnSchema => ({
  columnName,
  type: ColumnType.STRING,
  isNullable: true,
  isUnique: false,
  defaultValue: '',
  isSystemColumn: false,
  isNewColumn: true,
});

const emptyForm = { tableName: '', columns: [idColumn, newColumn('')] };

describe('createTableDraft', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores a draft only for the schema it was saved under', () => {
    const columns = [idColumn, newColumn('title'), newColumn('author_id')];
    const foreignKey: TableFormForeignKeySchema = {
      columnName: 'author_id',
      uid: 'fk-1',
      referenceTable: 'users',
      referenceColumns: [{ sourceColumn: 'author_id', referenceColumn: 'id' }],
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
    };

    saveCreateTableDraft(SCOPE, 'public', { tableName: 'posts', columns }, [foreignKey]);

    expect(loadCreateTableDraft(SCOPE, 'public')).toEqual({
      tableName: 'posts',
      columns,
      foreignKeys: [foreignKey],
    });
    expect(loadCreateTableDraft(SCOPE, 'analytics')).toBeNull();
  });

  it('keeps drafts for different projects apart', () => {
    const columns = [idColumn, newColumn('title')];

    saveCreateTableDraft('project-1', 'public', { tableName: 'posts', columns }, []);
    saveCreateTableDraft('project-2', 'public', { tableName: 'events', columns }, []);

    expect(loadCreateTableDraft('project-1', 'public')?.tableName).toBe('posts');
    expect(loadCreateTableDraft('project-2', 'public')?.tableName).toBe('events');
    expect(loadCreateTableDraft('default', 'public')).toBeNull();
  });

  it('does not confuse a scope and schema that split at a different hyphen', () => {
    const columns = [idColumn, newColumn('title')];

    saveCreateTableDraft('a-b', 'c', { tableName: 'first', columns }, []);
    saveCreateTableDraft('a', 'b-c', { tableName: 'second', columns }, []);

    expect(loadCreateTableDraft('a-b', 'c')?.tableName).toBe('first');
    expect(loadCreateTableDraft('a', 'b-c')?.tableName).toBe('second');
  });

  it('keeps a new column row that has no name yet', () => {
    const columns = [idColumn, newColumn('title'), newColumn('')];

    saveCreateTableDraft(SCOPE, 'public', { tableName: 'posts', columns }, []);

    expect(loadCreateTableDraft(SCOPE, 'public')?.columns).toEqual(columns);
  });

  it('keeps an unnamed column whose settings were changed', () => {
    const columns = [idColumn, { ...newColumn(''), isNullable: false, isUnique: true }];

    saveCreateTableDraft(SCOPE, 'public', { tableName: '', columns }, []);

    expect(loadCreateTableDraft(SCOPE, 'public')?.columns).toEqual(columns);
  });

  it('treats added rows nobody touched as no input', () => {
    const foreignKey: TableFormForeignKeySchema = {
      columnName: 'author_id',
      referenceTable: 'users',
      referenceColumns: [{ sourceColumn: 'author_id', referenceColumn: 'id' }],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    };
    const blankRows = { tableName: '', columns: [idColumn, newColumn(''), newColumn('')] };

    expect(hasCreateTableInput(blankRows, [])).toBe(false);
    expect(
      hasCreateTableInput({ tableName: '', columns: [idColumn, newColumn('title')] }, [])
    ).toBe(true);
    expect(hasCreateTableInput(blankRows, [foreignKey])).toBe(true);
  });

  it('does not store a form that has not been filled in', () => {
    saveCreateTableDraft(SCOPE, 'public', emptyForm, []);

    expect(store.size).toBe(0);
  });

  it('removes the stored draft when the form is emptied again', () => {
    const columns = [idColumn, newColumn('title')];
    saveCreateTableDraft(SCOPE, 'public', { tableName: 'posts', columns }, []);

    saveCreateTableDraft(SCOPE, 'public', emptyForm, []);

    expect(loadCreateTableDraft(SCOPE, 'public')).toBeNull();
    expect(store.size).toBe(0);
  });

  it('ignores a stored value that is not a valid draft', () => {
    const key = `${LOCAL_STORAGE_KEY_PREFIXES.createTableDraft}:${SCOPE}:public`;

    store.set(key, '{not json');
    expect(loadCreateTableDraft(SCOPE, 'public')).toBeNull();

    store.set(key, JSON.stringify({ tableName: 12, columns: 'nope' }));
    expect(loadCreateTableDraft(SCOPE, 'public')).toBeNull();
  });

  it('clears only the schema it is given', () => {
    saveCreateTableDraft(SCOPE, 'public', { tableName: 'posts', columns: [idColumn] }, []);
    saveCreateTableDraft(SCOPE, 'analytics', { tableName: 'events', columns: [idColumn] }, []);

    clearCreateTableDraft(SCOPE, 'public');

    expect(loadCreateTableDraft(SCOPE, 'public')).toBeNull();
    expect(loadCreateTableDraft(SCOPE, 'analytics')?.tableName).toBe('events');
  });
});
