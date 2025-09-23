import { ConvertedValue } from '@/components/datagrid/datagridTypes';
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
  async listTables(): Promise<string[]> {
    const data = await apiClient.request('/database/tables', {
      headers: apiClient.withAccessToken(),
    });
    // data is already unwrapped by request method and should be an array
    return Array.isArray(data) ? data : [];
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

  // Record operations
  /**
   * Data fetching method with built-in search, sorting, and pagination for UI components.
   *
   * @param tableName - Name of the table
   * @param limit - Number of records to fetch
   * @param offset - Number of records to skip
   * @param searchQuery - Search term to filter text columns
   * @param sortColumns - Sorting configuration
   * @returns Structured response with records and pagination info
   */
  async getTableRecords(
    tableName: string,
    limit = 10,
    offset = 0,
    searchQuery?: string,
    sortColumns?: { columnKey: string; direction: string }[]
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
          return type === 'string';
        })
        .map((col: ColumnSchema) => col.columnName);

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

    const response: {
      data: { [key: string]: ConvertedValue }[];
      pagination: { offset: number; limit: number; total: number };
    } = await apiClient.request(`/database/records/${tableName}?${params.toString()}`, {
      headers: {
        Prefer: 'count=exact',
      },
    });

    console.log(response);

    return {
      records: response.data,
      pagination: response.pagination,
    };
  }

  /**
   * Get a single record by foreign key value.
   * Specifically designed for foreign key lookups.
   *
   * @param tableName - Name of the table to search in
   * @param columnName - Name of the column to filter by
   * @param value - Value to match
   * @returns Single record or null if not found
   */
  async getRecordByForeignKeyValue(tableName: string, columnName: string, value: string) {
    const queryParams = `${columnName}=eq.${encodeURIComponent(value)}&limit=1`;
    const response = await this.getRecords(tableName, queryParams);

    // Return the first record if found, or null if not found
    if (response.records && response.records.length > 0) {
      return response.records[0];
    }
    return null;
  }

  async getRecords(tableName: string, queryParams: string = '') {
    const url = `/database/records/${tableName}${queryParams ? `?${queryParams}` : ''}`;
    const response = await apiClient.request(url, {
      headers: apiClient.withAccessToken(),
    });

    // Traditional REST: check if response is array (direct data) or wrapped
    if (Array.isArray(response)) {
      return {
        records: response,
        total: response.length,
      };
    }

    // If backend returns wrapped format for this endpoint
    if (response.data && Array.isArray(response.data)) {
      return {
        records: response.data,
        total: response.data.length,
      };
    }

    return {
      records: response,
      total: response.length,
    };
  }

  createRecords(table: string, records: { [key: string]: ConvertedValue }[]) {
    // if data is json and data[id] == "" then remove id from data, because can't assign '' to uuid
    records = records.map((record) => {
      if (typeof record === 'object' && record.id === '') {
        delete record.id;
      }
      return record;
    });
    return apiClient.request(`/database/records/${table}`, {
      method: 'POST',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(records),
    });
  }

  createRecord(table: string, data: { [key: string]: ConvertedValue }) {
    if (typeof data === 'object' && data.id === '') {
      // can't assign '' to uuid, so we need to remove it
      delete data.id;
    }
    return this.createRecords(table, [data]);
  }

  updateRecord(table: string, id: string, data: { [key: string]: ConvertedValue }) {
    return apiClient.request(`/database/records/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(data),
    });
  }

  deleteRecord(table: string, id: string) {
    return apiClient.request(`/database/records/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }
}

export const databaseService = new DatabaseService();
