import { ConvertedValue } from '@/components/datagrid/datagridTypes';
import { apiClient } from '@/lib/api/client';
import { ColumnSchema } from '@insforge/shared-schemas';
import { tableService } from './table.service';

export interface CSVImportMetadata {
  successCount: number;
  failedCount: number;
  failedRows: Array<{
    rowNumber: number;
    errors: string[];
  }>;
  totalFailedRows: number;
  message: string;
}
export interface CSVImportResponse {
  success: boolean;
  message?: string;
  data?: unknown;
  csvImport?: {
    successCount: number;
    failedCount: number;
    failedRows: Array<{
      rowNumber: number;
      errors: string[];
    }>;
    totalFailedRows: number;
  };
  rowErrors?: Array<{
    rowNumber: number;
    errors: string[];
  }>;
  totalRowErrors?: number;
  validRowCount?: number;
  errors?: string[];
}
export class RecordService {
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
      const schema = await tableService.getTableSchema(tableName);
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

  // PostgREST supports bulk deletes via in.() filter
  deleteRecords(table: string, ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve();
    }
    const idFilter = `in.(${ids.join(',')})`;
    return apiClient.request(`/database/records/${table}?id=${idFilter}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  }

  validateCSVFile(file: File): { valid: boolean; error?: string } {
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      return { valid: false, error: 'Invalid file type. Please upload a CSV file.' };
    }
    const maxSizeInBytes = 50 * 1024 * 1024;
    if (file.size > maxSizeInBytes) {
      return { valid: false, error: `File size exceeds the limit of ${maxSizeInBytes} bytes.` };
    }
    return { valid: true };
  }

  async importCSV(tableName: string, file: File): Promise<CSVImportResponse> {
    const validation = this.validateCSVFile(file);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid CSV file.');
    }

    const formData = new FormData();
    formData.append('file', file);

    return apiClient.request(`/database/records/import/${tableName}`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: formData,
    });
  }

  async downloadSampleCSV(tableName: string): Promise<void> {
    try {
      const token = apiClient.getToken();
      const endpoint = `/api/database/records/_meta/sample/${tableName}`;

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to download sample CSV: ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${tableName}_sample.csv`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to download sample CSV');
    }
  }
}

export const recordService = new RecordService();
