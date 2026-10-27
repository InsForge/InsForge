import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTableFormCreateDraftStorageKey,
  TableForm,
} from '#features/database/components/TableForm';
import { ColumnType } from '@insforge/shared-schemas';
import { tableFormSchema } from '#features/database/schema';
import { tableService } from '#features/database/services/table.service';

vi.mock('#features/database/services/table.service', () => ({
  tableService: { createTable: vi.fn() },
}));

const metadataMock = vi.hoisted(() => ({
  projectId: 'project-a' as string | undefined,
  isLoading: false,
}));

vi.mock('#lib/hooks/useMetadata', () => ({
  useProjectId: () => ({
    projectId: metadataMock.projectId,
    isLoading: metadataMock.isLoading,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../TableFormColumn', () => ({
  TableFormColumn: ({ column, index }: { column: { columnName: string }; index: number }) => (
    <input aria-label={`Column ${index + 1} name`} value={column.columnName} readOnly />
  ),
}));

vi.mock('../ForeignKeyPopover', () => ({
  ForeignKeyPopover: () => null,
}));

vi.mock('#components', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@insforge/ui', () => ({
  Button: (props: React.ComponentProps<'button'> & { variant?: string }) => (
    <button {...props}>{props.children}</button>
  ),
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderTableForm = (
  props: Partial<React.ComponentProps<typeof TableForm>> = {},
  queryClient = createQueryClient()
) => {
  const result = render(
    <QueryClientProvider client={queryClient}>
      <TableForm
        schemaName="public"
        open
        onOpenChange={vi.fn()}
        setFormIsDirty={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  );

  return { ...result, queryClient };
};

const createSavedDraft = (schemaName = 'public') => ({
  schemaName,
  tableName: 'draft_test',
  columns: [
    {
      columnName: 'user_id',
      type: ColumnType.UUID,
      defaultValue: '',
      isNullable: true,
      isUnique: false,
      isSystemColumn: false,
      isNewColumn: true,
    },
  ],
  foreignKeys: [
    {
      columnName: 'user_id',
      referenceTable: 'id',
      referenceColumns: [{ sourceColumn: 'user_id', referenceColumn: 'id' }],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
      uid: 'test-foreign-key',
    },
  ],
});

const expectDefaultCreateForm = () => {
  expect(screen.getByPlaceholderText('e.g., products, orders, customers')).toHaveValue('');
  const columnInputs = screen.getAllByRole('textbox', { name: /^Column \d+ name$/ });
  expect(columnInputs).toHaveLength(4);
  ['id', 'created_at', 'updated_at', ''].forEach((name, index) => {
    expect(columnInputs[index]).toHaveValue(name);
  });
  expect(screen.queryByRole('button', { name: /^Remove$/ })).not.toBeInTheDocument();
};

describe('TableForm draft storage', () => {
  beforeEach(() => {
    vi.mocked(tableService.createTable).mockReset();
    metadataMock.projectId = 'project-a';
    metadataMock.isLoading = false;
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
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

  it.each([{ type: ColumnType.INTEGER }, { isNullable: false }, { isUnique: true }])(
    'restores the whole draft with an unnamed modified column: %j',
    async (change) => {
      const draftKey = getTableFormCreateDraftStorageKey('project:project-a', 'public');
      const completedColumn = {
        columnName: 'title',
        type: ColumnType.STRING,
        defaultValue: '',
        isNullable: true,
        isUnique: false,
        isSystemColumn: false,
        isNewColumn: true,
      };
      const draft = {
        schemaName: 'public',
        tableName: 'products',
        columns: [completedColumn, { ...completedColumn, columnName: '', ...change }],
        foreignKeys: [],
      };
      window.localStorage.setItem(draftKey, JSON.stringify(draft));

      const { unmount } = renderTableForm();
      await waitFor(() => {
        expect(screen.getByPlaceholderText('e.g., products, orders, customers')).toHaveValue(
          'products'
        );
        expect(JSON.parse(window.localStorage.getItem(draftKey) ?? 'null')).toEqual(draft);
      });

      // A second mount simulates another refresh after the restored form saves.
      unmount();
      renderTableForm();
      await waitFor(() => {
        expect(screen.getByPlaceholderText('e.g., products, orders, customers')).toHaveValue(
          'products'
        );
        expect(JSON.parse(window.localStorage.getItem(draftKey) ?? 'null')).toEqual(draft);
      });
      expect(tableFormSchema.safeParse(draft).success).toBe(false);
    }
  );

  it.each([
    { columnName: 'user_id', expectedTableName: 'draft_test', restoresForeignKey: true },
    { columnName: 123, expectedTableName: '', restoresForeignKey: false },
  ])(
    'restores a draft only when its foreign keys are valid: %j',
    async ({ columnName, expectedTableName, restoresForeignKey }) => {
      const draftKey = getTableFormCreateDraftStorageKey('project:project-a', 'public');
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({
          schemaName: 'public',
          tableName: 'draft_test',
          columns: [
            {
              columnName: 'user_id',
              type: ColumnType.UUID,
              defaultValue: '',
              isNullable: true,
              isUnique: false,
              isSystemColumn: false,
              isNewColumn: true,
            },
          ],
          foreignKeys: [
            {
              columnName,
              referenceTable: 'id',
              referenceColumns: [{ sourceColumn: 'user_id', referenceColumn: 'id' }],
              onDelete: 'NO ACTION',
              onUpdate: 'NO ACTION',
              uid: 'test-foreign-key',
            },
          ],
        })
      );

      renderTableForm();

      await waitFor(() => {
        expect(screen.getByPlaceholderText('e.g., products, orders, customers')).toHaveValue(
          expectedTableName
        );
        if (restoresForeignKey) {
          expect(screen.getByText('id.id')).toBeInTheDocument();
        } else {
          expect(screen.queryByText('id.id')).not.toBeInTheDocument();
        }
      });
    }
  );

  it.each([
    { description: 'invalid JSON', storedValue: '{"tableName":"draft_test",' },
    {
      description: 'invalid column data',
      storedValue: JSON.stringify({ ...createSavedDraft(), columns: 'not-an-array' }),
    },
    {
      description: 'a mismatched schema name',
      storedValue: JSON.stringify(createSavedDraft('private')),
    },
  ])('starts with the default form for $description', async ({ storedValue }) => {
    const draftKey = getTableFormCreateDraftStorageKey('project:project-a', 'public');
    window.localStorage.setItem(draftKey, storedValue);

    renderTableForm();

    await waitFor(expectDefaultCreateForm);
  });

  it.each(['table-form-columns-draft', 'table-form-columns-draft:project%3Aproject-a'])(
    'ignores a draft under the legacy storage key %s',
    async (legacyKey) => {
      const storedValue = JSON.stringify(createSavedDraft());
      window.localStorage.setItem(legacyKey, storedValue);

      renderTableForm();

      await waitFor(expectDefaultCreateForm);
      expect(window.localStorage.getItem(legacyKey)).toBe(storedValue);
    }
  );

  it('clears the scoped draft after successful creation and does not restore it on reopening', async () => {
    const user = userEvent.setup();
    const draftKey = getTableFormCreateDraftStorageKey('project:project-a', 'public');
    const otherDraftKey = getTableFormCreateDraftStorageKey('project:project-b', 'public');
    const storedValue = JSON.stringify(createSavedDraft());
    window.localStorage.setItem(draftKey, storedValue);
    window.localStorage.setItem(otherDraftKey, storedValue);
    vi.mocked(tableService.createTable).mockResolvedValue({ tableName: 'draft_test' });

    // The page closes the form when creation succeeds.
    const onSuccess = vi.fn(() => unmount());
    const { unmount } = renderTableForm({ onSuccess });
    const createButton = screen.getByRole('button', { name: 'Create Table' });
    await waitFor(() => expect(createButton).toBeEnabled());
    expect(window.localStorage.getItem(draftKey)).not.toBeNull();
    await user.click(createButton);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('draft_test'));
    expect(tableService.createTable).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(draftKey)).toBeNull();
    expect(window.localStorage.getItem(otherDraftKey)).toBe(storedValue);

    renderTableForm();
    await waitFor(expectDefaultCreateForm);
  });

  it('keeps the draft when table creation fails', async () => {
    const user = userEvent.setup();
    const draftKey = getTableFormCreateDraftStorageKey('project:project-a', 'public');
    const draft = createSavedDraft();
    window.localStorage.setItem(draftKey, JSON.stringify(draft));
    vi.mocked(tableService.createTable).mockRejectedValue(new Error('Creation failed'));
    const onSuccess = vi.fn();
    renderTableForm({ onSuccess });

    const createButton = screen.getByRole('button', { name: 'Create Table' });
    await waitFor(() => expect(createButton).toBeEnabled());
    await user.click(createButton);

    expect(await screen.findByText('Creation failed')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(draftKey) ?? 'null')).toEqual(draft);
    expect(screen.getByPlaceholderText('e.g., products, orders, customers')).toHaveValue(
      'draft_test'
    );
  });

  it('clears a pending discarded scoped draft after project id resolution without restoring it', async () => {
    const onCreateDraftDiscardHandled = vi.fn();
    const discardedDraftKey = getTableFormCreateDraftStorageKey('project:project-a', 'public');
    const queryClient = createQueryClient();

    window.localStorage.setItem(
      discardedDraftKey,
      JSON.stringify({
        schemaName: 'public',
        tableName: 'discarded_table',
        columns: [
          {
            columnName: 'id',
            type: ColumnType.UUID,
            defaultValue: 'gen_random_uuid()',
            isPrimaryKey: true,
            isNullable: false,
            isUnique: true,
            isSystemColumn: true,
            isNewColumn: false,
          },
          {
            columnName: 'title',
            type: ColumnType.STRING,
            defaultValue: '',
            isNullable: true,
            isUnique: false,
            isSystemColumn: false,
            isNewColumn: true,
          },
        ],
        foreignKeys: [],
      })
    );

    metadataMock.projectId = undefined;
    metadataMock.isLoading = true;

    const { rerender } = renderTableForm(
      {
        skipCreateDraftRestore: true,
        onCreateDraftDiscardHandled,
      },
      queryClient
    );

    expect(window.localStorage.getItem(discardedDraftKey)).not.toBeNull();

    metadataMock.projectId = 'project-a';
    metadataMock.isLoading = false;

    rerender(
      <QueryClientProvider client={queryClient}>
        <TableForm
          schemaName="public"
          open
          onOpenChange={vi.fn()}
          setFormIsDirty={vi.fn()}
          skipCreateDraftRestore
          onCreateDraftDiscardHandled={onCreateDraftDiscardHandled}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(window.localStorage.getItem(discardedDraftKey)).toBeNull();
    });

    expect(onCreateDraftDiscardHandled).toHaveBeenCalledWith('public');
    expect(screen.getByPlaceholderText('e.g., products, orders, customers')).toHaveValue('');
  });
});
