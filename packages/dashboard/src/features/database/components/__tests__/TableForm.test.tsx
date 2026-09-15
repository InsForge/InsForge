import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColumnType, type TableSchema } from '@insforge/shared-schemas';
import type { TableFormColumnSchema, TableFormForeignKeySchema } from '#features/database/schema';
import {
  loadCreateTableDraft,
  saveCreateTableDraft,
} from '#features/database/utils/createTableDraft';

const toastMocks = vi.hoisted(() => ({
  showToast: vi.fn(),
}));

vi.mock('@insforge/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@insforge/ui')>();

  return {
    ...actual,
    useToast: () => ({
      showToast: toastMocks.showToast,
    }),
  };
});

vi.mock('#components', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Column rows and the foreign key picker load their own data, and drafts do not depend on them.
vi.mock('#features/database/components/TableFormColumn', () => ({ TableFormColumn: () => null }));
vi.mock('#features/database/components/ForeignKeyPopover', () => ({
  ForeignKeyPopover: () => null,
}));
vi.mock('#features/database/services/table.service', () => ({ tableService: {} }));

import { TableForm } from '#features/database/components/TableForm';

const SCHEMA = 'public';

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

const authorForeignKey: TableFormForeignKeySchema = {
  columnName: 'author_id',
  uid: 'fk-1',
  referenceTable: 'users',
  referenceColumns: [{ sourceColumn: 'author_id', referenceColumn: 'id' }],
  onDelete: 'NO ACTION',
  onUpdate: 'NO ACTION',
};

// An existing table with one foreign key, as the edit form receives it.
const ordersTable: TableSchema = {
  tableName: 'orders',
  columns: [
    { columnName: 'id', type: ColumnType.UUID, isNullable: false, isUnique: true },
    { columnName: 'user_id', type: ColumnType.UUID, isNullable: true, isUnique: false },
  ],
  foreignKeys: [
    {
      constraintName: 'orders_user_id_fkey',
      referenceTable: 'users',
      referenceColumns: [{ sourceColumn: 'user_id', referenceColumn: 'id' }],
      onDelete: 'CASCADE',
      onUpdate: 'NO ACTION',
    },
  ],
};

interface FormProps {
  draftScope?: string;
  mode?: 'create' | 'edit';
  editTable?: TableSchema;
}

function renderTableForm(initialProps: FormProps) {
  const queryClient = new QueryClient();
  const setFormIsDirty = vi.fn();
  const tree = (props: FormProps) => (
    <QueryClientProvider client={queryClient}>
      <TableForm
        schemaName={SCHEMA}
        open
        onOpenChange={vi.fn()}
        setFormIsDirty={setFormIsDirty}
        {...props}
      />
    </QueryClientProvider>
  );
  const view = render(tree(initialProps));

  return {
    setFormIsDirty,
    rerenderWith: (props: FormProps) => view.rerender(tree(props)),
  };
}

function tableNameInput() {
  return screen.getByPlaceholderText('e.g., products, orders, customers');
}

describe('TableForm create drafts', () => {
  beforeEach(() => {
    window.localStorage.clear();
    toastMocks.showToast.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns once while storage refuses the draft, then saves it once storage works', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const user = userEvent.setup();
    renderTableForm({ draftScope: 'project-1' });

    await user.type(tableNameInput(), 'post');

    expect(toastMocks.showToast).toHaveBeenCalledTimes(1);
    expect(toastMocks.showToast).toHaveBeenCalledWith(expect.any(String), 'warn');
    expect(loadCreateTableDraft('project-1', SCHEMA)).toBeNull();

    setItem.mockRestore();
    await user.type(tableNameInput(), 's');

    expect(loadCreateTableDraft('project-1', SCHEMA)?.tableName).toBe('posts');
    expect(toastMocks.showToast).toHaveBeenCalledTimes(1);
  });

  it('does not warn about a form with nothing typed when storage is unavailable', async () => {
    const refuse = () => {
      throw new Error('SecurityError');
    };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse);
    const user = userEvent.setup();
    renderTableForm({ draftScope: 'project-1' });

    await user.click(screen.getByRole('button', { name: 'Add Column' }));
    expect(toastMocks.showToast).not.toHaveBeenCalled();

    await user.type(tableNameInput(), 'posts');
    expect(toastMocks.showToast).toHaveBeenCalledTimes(1);

    // Emptying the form does not count as a save that worked, so typing again stays quiet.
    await user.clear(tableNameInput());
    await user.type(tableNameInput(), 'orders');
    expect(toastMocks.showToast).toHaveBeenCalledTimes(1);
  });

  it('restores a draft that only holds a foreign key without deleting it first', () => {
    saveCreateTableDraft(
      'project-1',
      SCHEMA,
      { tableName: '', columns: [idColumn, newColumn('')] },
      [authorForeignKey]
    );
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    renderTableForm({ draftScope: 'project-1' });

    expect(screen.getByText('users.id')).toBeInTheDocument();
    expect(removeItem).not.toHaveBeenCalled();
    expect(loadCreateTableDraft('project-1', SCHEMA)?.foreignKeys).toEqual([authorForeignKey]);
  });

  it('restores the draft when its scope arrives after an empty row was added', async () => {
    const columns = [idColumn, newColumn('title')];
    saveCreateTableDraft('project-1', SCHEMA, { tableName: 'posts', columns }, []);
    const user = userEvent.setup();
    const form = renderTableForm({});

    await user.click(screen.getByRole('button', { name: 'Add Column' }));
    form.rerenderWith({ draftScope: 'project-1' });

    expect(tableNameInput()).toHaveValue('posts');
    expect(loadCreateTableDraft('project-1', SCHEMA)?.tableName).toBe('posts');
  });

  it('keeps what was typed before the scope arrived and saves it under that scope', async () => {
    const user = userEvent.setup();
    const form = renderTableForm({});

    await user.type(tableNameInput(), 'orders');
    form.rerenderWith({ draftScope: 'project-1' });

    expect(tableNameInput()).toHaveValue('orders');
    expect(loadCreateTableDraft('project-1', SCHEMA)?.tableName).toBe('orders');
  });

  it('loads the new project draft when the scope changes and leaves the old one alone', async () => {
    saveCreateTableDraft('project-a', SCHEMA, { tableName: 'posts', columns: [idColumn] }, []);
    saveCreateTableDraft('project-b', SCHEMA, { tableName: 'events', columns: [idColumn] }, []);
    const user = userEvent.setup();
    const form = renderTableForm({ draftScope: 'project-a' });
    expect(tableNameInput()).toHaveValue('posts');

    form.rerenderWith({ draftScope: 'project-b' });
    expect(tableNameInput()).toHaveValue('events');

    await user.type(tableNameInput(), '_log');
    expect(loadCreateTableDraft('project-b', SCHEMA)?.tableName).toBe('events_log');
    expect(loadCreateTableDraft('project-a', SCHEMA)?.tableName).toBe('posts');
  });

  it('does not save the foreign keys of an edited table when the form switches to create', () => {
    const columns = [idColumn, newColumn('title')];
    saveCreateTableDraft('project-1', SCHEMA, { tableName: 'posts', columns }, []);
    const form = renderTableForm({ draftScope: 'project-1', mode: 'edit', editTable: ordersTable });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    form.rerenderWith({ draftScope: 'project-1', mode: 'create' });

    expect(tableNameInput()).toHaveValue('posts');
    expect(setItem.mock.calls.some(([, value]) => value.includes('user_id'))).toBe(false);
    expect(loadCreateTableDraft('project-1', SCHEMA)).toEqual({
      tableName: 'posts',
      columns,
      foreignKeys: [],
    });
  });

  it('forgets foreign key changes made while editing when the form switches to create', async () => {
    const user = userEvent.setup();
    const form = renderTableForm({ draftScope: 'project-1', mode: 'edit', editTable: ordersTable });

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(form.setFormIsDirty).toHaveBeenLastCalledWith(true);

    form.rerenderWith({ draftScope: 'project-1', mode: 'create' });

    expect(form.setFormIsDirty).toHaveBeenLastCalledWith(false);
    expect(loadCreateTableDraft('project-1', SCHEMA)).toBeNull();
  });
});
