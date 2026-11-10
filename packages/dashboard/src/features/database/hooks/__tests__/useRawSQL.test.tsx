import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRawSQL } from '#features/database/hooks/useRawSQL';
import { databaseTableQueryKeys } from '#features/database/queryKeys';

const advanceServiceMocks = vi.hoisted(() => ({
  runRawSQL: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('#features/database/services/advance.service', () => ({
  advanceService: {
    runRawSQL: advanceServiceMocks.runRawSQL,
  },
}));

vi.mock('@insforge/ui', () => ({
  useToast: () => ({ showToast: advanceServiceMocks.showToast }),
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useRawSQL mutation cache invalidation', () => {
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

  it('invalidates tables, table-schemas, tables-rls, and policies broadly when no schema context is provided', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    advanceServiceMocks.runRawSQL.mockResolvedValue({
      data: [],
      rowCount: 1,
      command: 'ALTER',
    });

    const { result } = renderHook(() => useRawSQL(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.executeSQL({
        query: 'ALTER TABLE users ENABLE ROW LEVEL SECURITY;',
      });
    });

    await waitFor(() => {
      expect(advanceServiceMocks.runRawSQL).toHaveBeenCalledWith(
        'ALTER TABLE users ENABLE ROW LEVEL SECURITY;',
        [],
        undefined
      );
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['database', 'tables'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['database', 'table-schemas'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['database', 'tables-rls'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['database', 'policies'],
      });
    });

    expect(advanceServiceMocks.showToast).toHaveBeenCalledWith(
      'SQL query executed successfully',
      'success'
    );
  });

  it('invalidates schema-specific query keys when schemaName option is provided', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    advanceServiceMocks.runRawSQL.mockResolvedValue({
      data: [],
      rowCount: 1,
      command: 'CREATE',
    });

    const { result } = renderHook(() => useRawSQL({ schemaName: 'tenant_b' }), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.executeSQL({
        query: 'CREATE TABLE tenant_b.documents (id INT PRIMARY KEY);',
      });
    });

    await waitFor(() => {
      expect(advanceServiceMocks.runRawSQL).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: databaseTableQueryKeys.tables('tenant_b'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['database', 'table-schemas', 'tenant_b'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: databaseTableQueryKeys.tableRlsStatuses('tenant_b'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['database', 'policies', 'tenant_b'],
      });
    });

    // Does not perform broad, non-targeted invalidation
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ['database', 'tables-rls'],
    });
  });

  it('does NOT trigger query invalidations on failed SQL execution', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    advanceServiceMocks.runRawSQL.mockRejectedValue(new Error('syntax error at or near "INVALID"'));
    const onErrorMock = vi.fn();

    const { result } = renderHook(() => useRawSQL({ onError: onErrorMock, showErrorToast: true }), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.executeSQL({ query: 'INVALID SQL STATEMENT;' });
    });

    await waitFor(() => {
      expect(onErrorMock).toHaveBeenCalled();
    });

    // Crucial requirement: No query invalidation occurs on failed SQL execution
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(advanceServiceMocks.showToast).toHaveBeenCalledWith(
      'syntax error at or near "INVALID"',
      'error'
    );
  });
});
