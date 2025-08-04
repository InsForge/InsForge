import { apiClient } from '@/lib/api/client';
import {
  ColumnSchema,
  GetTableSchemaResponse,
  CreateTableRequest,
  UpdateTableSchemaResponse,
  UpdateTableSchemaRequest,
} from '@insforge/shared-schemas';

export class DatabaseService {
  // Table operations
  async getTables(): Promise<string[]> {
    const data = await apiClient.request('/database/tables', {
      headers: apiClient.withApiKey(),
    });
    // data is already unwrapped by request method and should be an array
    return Array.isArray(data) ? data : [];
  }

  getTableSchema(tableName: string): Promise<GetTableSchemaResponse> {
    return apiClient.request(`/database/tables/${tableName}/schema`, {
      headers: apiClient.withApiKey(),
    });
  }

  createTable(tableName: string, columns: ColumnSchema[]) {
    const body: CreateTableRequest = { table_name: tableName, columns, rls_enabled: true };
    return apiClient.request('/database/tables', {
      method: 'POST',
      headers: apiClient.withApiKey({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    });
  }

  deleteTable(tableName: string) {
    return apiClient.request(`/database/tables/${tableName}`, {
      method: 'DELETE',
      headers: apiClient.withApiKey(),
    });
  }

  modifyTable(
    tableName: string,
    operations: UpdateTableSchemaRequest
  ): Promise<UpdateTableSchemaResponse | void> {
    return apiClient.request(`/database/tables/${tableName}`, {
      method: 'PATCH',
      headers: apiClient.withApiKey({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(operations),
    });
  }

  // Record operations
  async getTableRecords(
    tableName: string,
    limit = 10,
    offset = 0,
    searchQuery?: string,
    sortColumns?: any[]
  ) {
    const params = new URLSearchParams();
    params.set('limit', limit.toString());
    params.set('offset', offset.toString());

    // Construct PostgREST filter directly in frontend if search query is provided
    if (searchQuery && searchQuery.trim()) {
      const searchValue = searchQuery.trim();

      // Get table schema to identify text columns
      const schema = await this.getTableSchema(tableName);
      const textColumns = schema.columns
        .filter((col: ColumnSchema) => {
          const type = col.type.toLowerCase();
          return type === 'text' || type === 'varchar' || type.includes('character varying');
        })
        .map((col: ColumnSchema) => col.name);

      if (textColumns.length > 0) {
        // Create PostgREST OR filter for text columns
        const orFilters = textColumns
          .map((column: string) => `${column}.ilike.*${searchValue}*`)
          .join(',');
        params.set('or', `(${orFilters})`);
      }
    }

    // Add sorting if provided - PostgREST uses "order" parameter
    if (sortColumns && sortColumns.length > 0) {
      const orderParam = sortColumns
        .map((col) => `${col.columnKey}.${col.direction.toLowerCase()}`)
        .join(',');
      params.set('order', orderParam);
    }

    const response = await apiClient.request(
      `/database/records/${tableName}?${params.toString()}`,
      {
        headers: apiClient.withApiKey(),
      }
    );

    // Traditional REST: check if response is array (direct data) or wrapped
    if (Array.isArray(response)) {
      return {
        records: response,
        total: response.length,
      };
    }

    if (response.records && Array.isArray(response.records)) {
      return response;
    }

    // Fallback
    return {
      records: [],
      total: 0,
    };
  }

  async getRecords(tableName: string, queryParams: string = '') {
    const url = `/database/records/${tableName}${queryParams ? `?${queryParams}` : ''}`;
    const response = await apiClient.request(url, {
      headers: apiClient.withApiKey(),
    });

    // Traditional REST: check if response is array (direct data) or wrapped
    if (Array.isArray(response)) {
      return {
        records: response,
        total: response.length,
      };
    }

    // If backend returns wrapped format for this endpoint
    if (response.records && Array.isArray(response.records)) {
      return response;
    }

    return {
      records: response,
      total: response.length,
    };
  }

  getRecord(table: string, id: string) {
    return apiClient.request(`/database/records/${table}?id=eq.${id}`, {
      headers: apiClient.withApiKey(),
    });
  }

  createRecords(table: string, records: any[]) {
    // if data is json and data[id] == "" then remove id from data, because can't assign '' to uuid
    records = records.map((record) => {
      if (typeof record === 'object' && record.id === '') {
        delete record.id;
      }
      return record;
    });
    return apiClient.request(`/database/records/${table}`, {
      method: 'POST',
      headers: apiClient.withApiKey({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(records),
    });
  }

  createRecord(table: string, data: any) {
    if (typeof data === 'object' && data.id === '') {
      // can't assign '' to uuid, so we need to remove it
      delete data.id;
    }
    return this.createRecords(table, [data]);
  }

  updateRecord(table: string, id: string, data: any) {
    return apiClient.request(`/database/records/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: apiClient.withApiKey({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(data),
    });
  }

  deleteRecord(table: string, id: string) {
    return apiClient.request(`/database/records/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: apiClient.withApiKey(),
    });
  }
}

export const databaseService = new DatabaseService();
