import { apiClient } from '@/lib/api/client';
import {
  ColumnSchema,
  GetTableSchemaResponse,
  CreateTableRequest,
  UpdateTableSchemaResponse,
  UpdateTableSchemaRequest,
} from '@insforge/shared-schemas';

export class TableService {
  async listTables(): Promise<string[]> {
    return await apiClient.request('/database/tables', {
      headers: apiClient.withAccessToken(),
    });
  }

  getTableSchema(tableName: string): Promise<GetTableSchemaResponse> {
    return apiClient.request(`/database/tables/${tableName}/schema`, {
      headers: apiClient.withAccessToken(),
    });
  }

  createTable(tableName: string, columns: ColumnSchema[]) {
    const body: CreateTableRequest = { tableName: tableName, columns, rlsEnabled: true };
    return apiClient.request('/database/tables', {
      method: 'POST',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    });
  }

  deleteTable(tableName: string) {
    return apiClient.request(`/database/tables/${tableName}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  updateTableSchema(
    tableName: string,
    operations: UpdateTableSchemaRequest
  ): Promise<UpdateTableSchemaResponse | void> {
    return apiClient.request(`/database/tables/${tableName}/schema`, {
      method: 'PATCH',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(operations),
    });
  }
}

export const tableService = new TableService();
