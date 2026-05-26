import { ConvertedValue } from '#components/datagrid/datagridTypes';
import { DEFAULT_DATABASE_SCHEMA } from '#features/database/helpers';
import { apiClient } from '#lib/api/client';
import { BulkUpsertResponse } from '@insforge/shared-schemas';

interface AdminRecordListResponse {
  data: { [key: string]: ConvertedValue }[];
  pagination: { offset: number; limit: number; total: number };
}

export class RecordService {
  private buildAdminRecordsPath(
    tableName: string,
    schemaName: string,
    suffix: string = '',
    params?: URLSearchParams
  ): string {
    const nextParams = params ? new URLSearchParams(params) : new URLSearchParams();

    if (schemaName !== DEFAULT_DATABASE_SCHEMA) {
      nextParams.set('schema', schemaName);
    }

    const query = nextParams.toString();
    return `/database/admin/tables/${encodeURIComponent(tableName)}/records${suffix}${query ? `?${query}` : ''}`;
  }

  private buildSortParam(sortColumns?: { columnKey: string; direction: string }[]): string | null {
    if (!sortColumns || sortColumns.length === 0) {
      return null;
    }

    return sortColumns
      .map((column) => `${column.columnKey}:${column.direction.toLowerCase()}`)
      .join(',');
  }

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
    schemaName: string = DEFAULT_DATABASE_SCHEMA,
    limit = 10,
    offset = 0,
    searchQuery?: string,
    sortColumns?: { columnKey: string; direction: string }[]
  ) {
    const params = new URLSearchParams();
    params.set('limit', limit.toString());
    params.set('offset', offset.toString());

    if (searchQuery && searchQuery.trim()) {
      params.set('search', searchQuery.trim());
    }

    const sortParam = this.buildSortParam(sortColumns);
    if (sortParam) {
      params.set('sort', sortParam);
    }

    const response: AdminRecordListResponse = await apiClient.request(
      this.buildAdminRecordsPath(tableName, schemaName, '', params),
      {
        headers: {
          Prefer: 'count=exact',
        },
      }
    );

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
  async getRecordByForeignKeyValue(
    tableName: string,
    columnName: string,
    value: string,
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ) {
    const params = new URLSearchParams({
      column: columnName,
      value,
    });

    return apiClient.request(this.buildAdminRecordsPath(tableName, schemaName, '/lookup', params), {
      headers: apiClient.withAccessToken(),
    });
  }

  async getRecords(
    tableName: string,
    schemaName: string = DEFAULT_DATABASE_SCHEMA,
    queryParams: string = ''
  ) {
    const params = new URLSearchParams(queryParams);
    const limit = Number(params.get('limit') || '100');
    const offset = Number(params.get('offset') || '0');
    const sort = params.get('order');
    const normalizedSort = sort
      ? sort
          .split(',')
          .map((clause) => clause.trim())
          .filter(Boolean)
          .map((clause) => {
            const [columnName, direction = 'asc'] = clause.split('.');
            return `${columnName}:${direction}`;
          })
          .join(',')
      : null;

    let filterColumn: string | undefined;
    let filterValue: string | undefined;

    for (const [key, rawValue] of params.entries()) {
      if (key === 'limit' || key === 'offset' || key === 'order') {
        continue;
      }

      if (!rawValue.startsWith('eq.')) {
        throw new Error('Only simple eq filters are supported by the dashboard admin records API.');
      }

      if (filterColumn) {
        throw new Error(
          'Only one exact-match filter is supported by the dashboard admin records API.'
        );
      }

      filterColumn = key;
      filterValue = rawValue.slice(3);
    }

    const requestParams = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      ...(normalizedSort ? { sort: normalizedSort } : {}),
      ...(filterColumn && filterValue !== undefined ? { filterColumn, filterValue } : {}),
    });

    const response: AdminRecordListResponse = await apiClient.request(
      this.buildAdminRecordsPath(tableName, schemaName, '', requestParams),
      {
        headers: apiClient.withAccessToken({
          Prefer: 'count=exact',
        }),
      }
    );

    return {
      records: response.data,
      total: response.pagination.total,
    };
  }

  createRecords(
    table: string,
    records: { [key: string]: ConvertedValue }[],
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ) {
    // if data is json and data[id] == "" then remove id from data, because can't assign '' to uuid
    records = records.map((record) => {
      if (typeof record === 'object' && record.id === '') {
        delete record.id;
      }
      return record;
    });

    return apiClient.request(this.buildAdminRecordsPath(table, schemaName), {
      method: 'POST',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(records),
    });
  }

  createRecord(
    table: string,
    data: { [key: string]: ConvertedValue },
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ) {
    if (typeof data === 'object' && data.id === '') {
      // can't assign '' to uuid, so we need to remove it
      delete data.id;
    }
    return this.createRecords(table, [data], schemaName);
  }

  updateRecord(
    table: string,
    pkColumn: string,
    pkValue: string,
    data: { [key: string]: ConvertedValue },
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ) {
    const params = new URLSearchParams({ pkColumn });

    return apiClient.request(
      this.buildAdminRecordsPath(table, schemaName, `/${encodeURIComponent(pkValue)}`, params),
      {
        method: 'PATCH',
        headers: apiClient.withAccessToken({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(data),
      }
    );
  }

  deleteRecords(
    table: string,
    pkColumn: string,
    pkValues: string[],
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ) {
    if (!pkValues.length) {
      return Promise.resolve();
    }
    const params = new URLSearchParams({
      pkColumn,
      pkValues: pkValues.join(','),
    });

    return apiClient.request(this.buildAdminRecordsPath(table, schemaName, '', params), {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  validateCSVFile(file: File): { valid: boolean; error?: string } {
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      return { valid: false, error: 'Invalid file type. Please upload a CSV file.' };
    }
    return { valid: true };
  }

  async importCSV(
    tableName: string,
    file: File,
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ): Promise<BulkUpsertResponse> {
    const validation = this.validateCSVFile(file);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid CSV file.');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('table', tableName);
    formData.append('schema', schemaName);

    const response: BulkUpsertResponse = await apiClient.request(`/database/advance/bulk-upsert`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: formData,
    });
    return response;
  }
}

export const recordService = new RecordService();
