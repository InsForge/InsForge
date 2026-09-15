import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColumnType } from '@insforge/shared-schemas';
import type { TableFormColumnSchema, TableFormForeignKeySchema } from '#features/database/schema';
import { LOCAL_STORAGE_KEY_PREFIXES } from '#lib/utils/constants';
import {
  clearCreateTableDraft,
  loadCreateTableDraft,
  saveCreateTableDraft,
} from '#features/database/utils/createTableDraft';

const PROJECT = 'project-1';

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

    saveCreateTableDraft(PROJECT, 'public', { tableName: 'posts', columns }, [foreignKey]);

    expect(loadCreateTableDraft(PROJECT, 'public')).toEqual({
      tableName: 'posts',
      columns,
      foreignKeys: [foreignKey],
    });
    expect(loadCreateTableDraft(PROJECT, 'analytics')).toBeNull();
  });

  it('keeps drafts for different projects apart', () => {
    const columns = [idColumn, newColumn('title')];

    saveCreateTableDraft('project-1', 'public', { tableName: 'posts', columns }, []);
    saveCreateTableDraft('project-2', 'public', { tableName: 'events', columns }, []);

    expect(loadCreateTableDraft('project-1', 'public')?.tableName).toBe('posts');
    expect(loadCreateTableDraft('project-2', 'public')?.tableName).toBe('events');
    expect(loadCreateTableDraft(undefined, 'public')).toBeNull();
  });

  it('keeps a new column row that has no name yet', () => {
    const columns = [idColumn, newColumn('title'), newColumn('')];

    saveCreateTableDraft(PROJECT, 'public', { tableName: 'posts', columns }, []);

    expect(loadCreateTableDraft(PROJECT, 'public')?.columns).toEqual(columns);
  });

  it('does not store a form that has not been filled in', () => {
    saveCreateTableDraft(PROJECT, 'public', emptyForm, []);

    expect(store.size).toBe(0);
  });

  it('removes the stored draft when the form is emptied again', () => {
    const columns = [idColumn, newColumn('title')];
    saveCreateTableDraft(PROJECT, 'public', { tableName: 'posts', columns }, []);

    saveCreateTableDraft(PROJECT, 'public', emptyForm, []);

    expect(loadCreateTableDraft(PROJECT, 'public')).toBeNull();
    expect(store.size).toBe(0);
  });

  it('ignores a stored value that is not a valid draft', () => {
    const key = `${LOCAL_STORAGE_KEY_PREFIXES.createTableDraft}-${PROJECT}-public`;

    store.set(key, '{not json');
    expect(loadCreateTableDraft(PROJECT, 'public')).toBeNull();

    store.set(key, JSON.stringify({ tableName: 12, columns: 'nope' }));
    expect(loadCreateTableDraft(PROJECT, 'public')).toBeNull();
  });

  it('clears only the schema it is given', () => {
    saveCreateTableDraft(PROJECT, 'public', { tableName: 'posts', columns: [idColumn] }, []);
    saveCreateTableDraft(PROJECT, 'analytics', { tableName: 'events', columns: [idColumn] }, []);

    clearCreateTableDraft(PROJECT, 'public');

    expect(loadCreateTableDraft(PROJECT, 'public')).toBeNull();
    expect(loadCreateTableDraft(PROJECT, 'analytics')?.tableName).toBe('events');
  });
});
