import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTables } from '#features/database/hooks/useTables';
import { databaseTableQueryKeys } from '#features/database/queryKeys';

const tableServiceMocks = vi.hoisted(() => ({
  listTables: vi.fn(),
  getTableSchema: vi.fn(),
  createTable: vi.fn(),
  deleteTable: vi.fn(),
  updateTableSchema: vi.fn(),
  enableTableRLS: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('#features/database/services/table.service', () => ({
  tableService: {
    listTables: tableServiceMocks.listTables,
    getTableSchema: tableServiceMocks.getTableSchema,
    createTable: tableServiceMocks.createTable,
    deleteTable: tableServiceMocks.deleteTable,
    updateTableSchema: tableServiceMocks.updateTableSchema,
    enableTableRLS: tableServiceMocks.enableTableRLS,
  },
}));

vi.mock('@insforge/ui', () => ({
  useToast: () => ({ showToast: tableServiceMocks.showToast }),
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useTables mutation cache invalidation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    tableServiceMocks.listTables.mockResolvedValue(['existing_table']);
  });

  it('invalidates tables, tableSchema, and tableRlsStatuses on successful table creation', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    tableServiceMocks.createTable.mockResolvedValue({ tableName: 'new_table' });

    const { result } = renderHook(() => useTables('public'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.createTable({
        tableName: 'new_table',
        columns: [],
      });
    });

    await waitFor(() => {
      expect(tableServiceMocks.createTable).toHaveBeenCalledWith('public', 'new_table', []);
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: databaseTableQueryKeys.tables('public'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: databaseTableQueryKeys.tableSchema('public', 'new_table'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: databaseTableQueryKeys.tableRlsStatuses('public'),
      });
    });

    expect(tableServiceMocks.showToast).toHaveBeenCalledWith(
      'Table created successfully',
      'success'
    );
  });

  it('invalidates tables, tableSchema, tableRlsStatuses, and policies on successful table deletion', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    tableServiceMocks.deleteTable.mockResolvedValue({ message: 'Table deleted' });

    const { result } = renderHook(() => useTables('public'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.deleteTable('old_table');
    });

    await waitFor(() => {
      expect(tableServiceMocks.deleteTable).toHaveBeenCalledWith('old_table', 'public');
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: databaseTableQueryKeys.tables('public'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: databaseTableQueryKeys.tableSchema('public', 'old_table'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: databaseTableQueryKeys.tableRlsStatuses('public'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['database', 'policies', 'public'],
      });
    });

    expect(tableServiceMocks.showToast).toHaveBeenCalledWith(
      'Table deleted successfully',
      'success'
    );
  });

  it('targets the specific schema for RLS invalidations on custom schemas', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    tableServiceMocks.createTable.mockResolvedValue({ tableName: 'tenant_records' });
    tableServiceMocks.deleteTable.mockResolvedValue({ message: 'Deleted' });

    const { result } = renderHook(() => useTables('tenant_a'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.createTable({
        tableName: 'tenant_records',
        columns: [],
      });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: databaseTableQueryKeys.tableRlsStatuses('tenant_a'),
      });
    });

    // Verify it did not invalidate public schema RLS status
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: databaseTableQueryKeys.tableRlsStatuses('public'),
    });

    invalidateSpy.mockClear();

    await act(async () => {
      result.current.deleteTable('tenant_records');
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: databaseTableQueryKeys.tableRlsStatuses('tenant_a'),
      });
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: databaseTableQueryKeys.tableRlsStatuses('public'),
    });
  });

  it('invalidates tableSchema, tableRlsStatuses, and policies on enableTableRLS', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    tableServiceMocks.enableTableRLS.mockResolvedValue({ message: 'RLS enabled' });

    const { result } = renderHook(() => useTables('public'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.enableTableRLS('unprotected_table');
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: databaseTableQueryKeys.tableSchema('public', 'unprotected_table'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: databaseTableQueryKeys.tableRlsStatuses('public'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['database', 'policies', 'public'],
    });
    expect(tableServiceMocks.showToast).toHaveBeenCalledWith(
      'Row-Level Security enabled successfully',
      'success'
    );
  });
});
