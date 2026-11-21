import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMock = vi.hoisted(() => ({
  request: vi.fn(),
  withAccessToken: vi.fn((headers?: Record<string, string>) => ({
    Authorization: 'Bearer test-token',
    ...headers,
  })),
}));

vi.mock('#lib/api/client', () => ({
  apiClient: apiClientMock,
}));

import { tableService } from '#features/database/services/table.service';

describe('TableService URL encoding and path construction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClientMock.request.mockResolvedValue({});
  });

  describe('getTableSchema', () => {
    it('constructs path for standard table names', async () => {
      await tableService.getTableSchema('users', 'public');
      expect(apiClientMock.request).toHaveBeenCalledWith(
        '/database/tables/users/schema',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        })
      );
    });

    it('encodes table names containing spaces', async () => {
      await tableService.getTableSchema('order items', 'public');
      expect(apiClientMock.request).toHaveBeenCalledWith(
        '/database/tables/order%20items/schema',
        expect.anything()
      );
    });

    it('encodes table names with reserved URL characters and preserves schema query', async () => {
      await tableService.getTableSchema('user/profile', 'custom_schema');
      expect(apiClientMock.request).toHaveBeenCalledWith(
        '/database/tables/user%2Fprofile/schema?schema=custom_schema',
        expect.anything()
      );
    });
  });

  describe('deleteTable', () => {
    it('constructs path for standard table names', async () => {
      await tableService.deleteTable('orders', 'public');
      expect(apiClientMock.request).toHaveBeenCalledWith(
        '/database/tables/orders',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('encodes table names with spaces and preserves custom schema', async () => {
      await tableService.deleteTable('audit logs', 'tenant_1');
      expect(apiClientMock.request).toHaveBeenCalledWith(
        '/database/tables/audit%20logs?schema=tenant_1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('encodes table names with special characters like #', async () => {
      await tableService.deleteTable('data#1', 'public');
      expect(apiClientMock.request).toHaveBeenCalledWith(
        '/database/tables/data%231',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('enableTableRLS', () => {
    it('constructs path for standard table names', async () => {
      await tableService.enableTableRLS('todos', 'public');
      expect(apiClientMock.request).toHaveBeenCalledWith(
        '/database/tables/todos/enable-rls',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('encodes table names containing spaces', async () => {
      await tableService.enableTableRLS('user notes', 'public');
      expect(apiClientMock.request).toHaveBeenCalledWith(
        '/database/tables/user%20notes/enable-rls',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('encodes table names with special characters and preserves custom schema', async () => {
      await tableService.enableTableRLS('group/role', 'auth_scope');
      expect(apiClientMock.request).toHaveBeenCalledWith(
        '/database/tables/group%2Frole/enable-rls?schema=auth_scope',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('updateTableSchema', () => {
    const emptyOperations = {};

    it('constructs path for standard table names', async () => {
      await tableService.updateTableSchema('customers', emptyOperations, 'public');
      expect(apiClientMock.request).toHaveBeenCalledWith(
        '/database/tables/customers/schema',
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('encodes table names containing spaces', async () => {
      await tableService.updateTableSchema('archived events', emptyOperations, 'public');
      expect(apiClientMock.request).toHaveBeenCalledWith(
        '/database/tables/archived%20events/schema',
        expect.objectContaining({ method: 'PATCH' })
      );
    });

    it('encodes table names with special characters like &', async () => {
      await tableService.updateTableSchema('app&db', emptyOperations, 'custom_schema');
      expect(apiClientMock.request).toHaveBeenCalledWith(
        '/database/tables/app%26db/schema?schema=custom_schema',
        expect.objectContaining({ method: 'PATCH' })
      );
    });
  });
});
