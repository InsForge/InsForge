import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TableForm } from '#features/database/components/TableForm';
import { databaseTableQueryKeys } from '#features/database/queryKeys';
import { ColumnType } from '@insforge/shared-schemas';

const tableServiceMocks = vi.hoisted(() => ({
  createTable: vi.fn(),
  updateTableSchema: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('#features/database/services/table.service', () => ({
  tableService: {
    createTable: tableServiceMocks.createTable,
    updateTableSchema: tableServiceMocks.updateTableSchema,
  },
}));

vi.mock('@insforge/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@insforge/ui');
  return {
    ...actual,
    useToast: () => ({ showToast: tableServiceMocks.showToast }),
  };
});

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('TableForm RLS query cache invalidation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  it('invalidates tableRlsStatuses on table creation success', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    tableServiceMocks.createTable.mockResolvedValue({
      tableName: 'articles',
      schemaName: 'public',
      columns: [],
      rlsEnabled: true,
    });

    const { container } = render(
      <TableForm
        open={true}
        mode="create"
        schemaName="public"
        onOpenChange={vi.fn()}
        setFormIsDirty={vi.fn()}
      />,
      { wrapper: createWrapper(queryClient) }
    );

    const tableNameInput = container.querySelector('input[name="tableName"]')!;
    fireEvent.change(tableNameInput, { target: { value: 'articles' } });

    const userColumnNameInput = container.querySelector('input[name="columns.3.columnName"]')!;
    fireEvent.change(userColumnNameInput, { target: { value: 'title' } });

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(tableServiceMocks.createTable).toHaveBeenCalled();
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: databaseTableQueryKeys.tableRlsStatuses('public'),
      });
    });
  }, 15000);

  it('invalidates tableRlsStatuses when renaming an existing table', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    tableServiceMocks.updateTableSchema.mockResolvedValue({
      tableName: 'renamed_notes',
      schemaName: 'public',
      message: 'table schema updated successfully',
    });

    const editTable = {
      tableName: 'notes',
      columns: [
        {
          columnName: 'id',
          type: ColumnType.UUID,
          isPrimaryKey: true,
          isNullable: false,
          isUnique: true,
          defaultValue: 'gen_random_uuid()',
        },
        {
          columnName: 'content',
          type: ColumnType.STRING,
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          defaultValue: '',
        },
      ],
      primaryKeys: ['id'],
      foreignKeys: [],
    };

    const { container } = render(
      <TableForm
        open={true}
        mode="edit"
        editTable={editTable}
        schemaName="public"
        onOpenChange={vi.fn()}
        setFormIsDirty={vi.fn()}
      />,
      { wrapper: createWrapper(queryClient) }
    );

    const tableNameInput = container.querySelector('input[name="tableName"]')!;
    fireEvent.change(tableNameInput, { target: { value: 'renamed_notes' } });

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(tableServiceMocks.updateTableSchema).toHaveBeenCalledWith(
        'notes',
        expect.objectContaining({
          renameTable: { newTableName: 'renamed_notes' },
        }),
        'public'
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: databaseTableQueryKeys.tableRlsStatuses('public'),
      });
    });
  }, 15000);

  it('does NOT invalidate tableRlsStatuses when updating a table without renaming it', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    tableServiceMocks.updateTableSchema.mockResolvedValue({
      tableName: 'notes',
      schemaName: 'public',
      message: 'table schema updated successfully',
    });

    const editTable = {
      tableName: 'notes',
      columns: [
        {
          columnName: 'id',
          type: ColumnType.UUID,
          isPrimaryKey: true,
          isNullable: false,
          isUnique: true,
          defaultValue: 'gen_random_uuid()',
        },
        {
          columnName: 'content',
          type: ColumnType.STRING,
          isPrimaryKey: false,
          isNullable: true,
          isUnique: false,
          defaultValue: '',
        },
      ],
      primaryKeys: ['id'],
      foreignKeys: [],
    };

    const { container } = render(
      <TableForm
        open={true}
        mode="edit"
        editTable={editTable}
        schemaName="public"
        onOpenChange={vi.fn()}
        setFormIsDirty={vi.fn()}
      />,
      { wrapper: createWrapper(queryClient) }
    );

    // Modify default value of the content column (columns.1.defaultValue)
    const defaultValueInput = container.querySelector('input[name="columns.1.defaultValue"]')!;
    fireEvent.change(defaultValueInput, { target: { value: 'default_note' } });

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(tableServiceMocks.updateTableSchema).toHaveBeenCalledWith(
        'notes',
        expect.not.objectContaining({
          renameTable: expect.anything(),
        }),
        'public'
      );
    });

    // tableRlsStatuses should NOT be invalidated because the table name didn't change
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: databaseTableQueryKeys.tableRlsStatuses('public'),
    });
  }, 15000);
});
