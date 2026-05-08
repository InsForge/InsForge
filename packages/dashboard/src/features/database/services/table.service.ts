import { apiClient } from '#lib/api/client';
import { buildDatabaseSchemaSearch, DEFAULT_DATABASE_SCHEMA } from '#features/database/helpers';
import {
  ColumnSchema,
  CreateTableRequest,
  GetTableSchemaResponse,
  UpdateTableSchemaRequest,
  UpdateTableSchemaResponse,
} from '@insforge/shared-schemas';

export class TableService {
  async listTables(schemaName: string = DEFAULT_DATABASE_SCHEMA): Promise<string[]> {
    return await apiClient.request(`/database/tables${buildDatabaseSchemaSearch(schemaName)}`, {
      headers: apiClient.withAccessToken(),
    });
  }

  getTableSchema(
    tableName: string,
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ): Promise<GetTableSchemaResponse> {
    return apiClient.request(
      `/database/tables/${tableName}/schema${buildDatabaseSchemaSearch(schemaName)}`,
      {
        headers: apiClient.withAccessToken(),
      }
    );
  }

  createTable(schemaName: string, tableName: string, columns: ColumnSchema[]) {
    const body: CreateTableRequest = { tableName, columns, rlsEnabled: true };

    return apiClient.request(`/database/tables${buildDatabaseSchemaSearch(schemaName)}`, {
      method: 'POST',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    });
  }

  deleteTable(tableName: string, schemaName: string = DEFAULT_DATABASE_SCHEMA) {
    return apiClient.request(
      `/database/tables/${tableName}${buildDatabaseSchemaSearch(schemaName)}`,
      {
        method: 'DELETE',
        headers: apiClient.withAccessToken(),
      }
    );
  }

  updateTableSchema(
    tableName: string,
    operations: UpdateTableSchemaRequest,
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ): Promise<UpdateTableSchemaResponse | void> {
    return apiClient.request(
      `/database/tables/${tableName}/schema${buildDatabaseSchemaSearch(schemaName)}`,
      {
        method: 'PATCH',
        headers: apiClient.withAccessToken({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(operations),
      }
    );
  }
}

export const tableService = new TableService();
