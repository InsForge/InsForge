import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTableFormCreateDraftStorageKey,
  TableForm,
} from '#features/database/components/TableForm';
import { ColumnType } from '@insforge/shared-schemas';
import { tableFormSchema } from '#features/database/schema';

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
  TableFormColumn: () => null,
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

describe('TableForm draft storage', () => {
  beforeEach(() => {
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

  it.each([
    { type: ColumnType.INTEGER },
    { isNullable: false },
    { isUnique: true },
  ])('restores the whole draft with an unnamed modified column: %j', async (change) => {
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
