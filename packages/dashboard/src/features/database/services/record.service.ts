import { ConvertedValue } from '#components/datagrid/datagridTypes';
import { DEFAULT_DATABASE_SCHEMA, type RecordPrimaryKey } from '#features/database/helpers';
import { apiClient } from '#lib/api/client';
import { getDashboardApiBaseUrl } from '#lib/config/runtime';
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
   * Get a single record by foreign key value(s).
   * Supports composite foreign keys via multiple columns/values.
   *
   * @param tableName - Name of the table to search in
   * @param columns - Column name(s) to filter by
   * @param values - Value(s) to match (parallel array to columns)
   * @returns Single record or null if not found
   */
  async getRecordByForeignKeyValue(
    tableName: string,
    columns: string[],
    values: string[],
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ) {
    if (columns.length === 0 || columns.length !== values.length) {
      throw new Error('Columns and values must have the same non-zero length');
    }

    const params = new URLSearchParams();
    columns.forEach((col, i) => {
      params.append('column', col);
      params.append('value', values[i]);
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
    primaryKey: RecordPrimaryKey,
    data: { [key: string]: ConvertedValue },
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ) {
    // pkKeys (the full primary-key tuple) and data travel in the body so composite
    // keys are validated structurally instead of being crammed into the query string.
    return apiClient.request(this.buildAdminRecordsPath(table, schemaName, ''), {
      method: 'PATCH',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ pkKeys: primaryKey, data }),
    });
  }

  deleteRecords(
    table: string,
    primaryKeys: RecordPrimaryKey[],
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ) {
    if (!primaryKeys.length) {
      return Promise.resolve();
    }
    // pkKeys (one tuple per record) travels in the body so each selected row is
    // matched exactly without a length-limited query string.
    return apiClient.request(this.buildAdminRecordsPath(table, schemaName, ''), {
      method: 'DELETE',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ pkKeys: primaryKeys }),
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

  /**
   * Exports a database table's records as a CSV file.
   *
   * Note: While the backend streams the response, this frontend method attempts to use the
   * File System Access API (window.showSaveFilePicker) to write response.body directly to disk.
   * If unsupported, it falls back to response.body.getReader() to buffer the stream chunks into
   * a Blob in browser memory before triggering the native download.
   * Extremely large tables may exhaust browser tab memory on browsers without File System Access support.
   */
  async exportTableAsCSV(
    tableName: string,
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ): Promise<{ limited: boolean }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const hasSaveFilePicker =
      typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker ===
      'function';
    const rowLimit = hasSaveFilePicker ? undefined : 10000;

    try {
      const response = await fetch(`${getDashboardApiBaseUrl()}/database/advance/export`, {
        method: 'POST',
        headers: apiClient.withAccessToken({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          tables: [tableName],
          schema: schemaName,
          format: 'csv',
          rowLimit,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        let msg = 'Failed to export CSV';
        try {
          const parsed = JSON.parse(text);
          if (parsed.message) {
            msg = parsed.message;
          }
        } catch {
          /* ignore invalid JSON response content */
        }
        throw new Error(msg);
      }

      // Parse filename from Content-Disposition header
      const disposition = response.headers.get('content-disposition');
      let filename = `${tableName}_export.csv`;
      if (disposition && disposition.indexOf('attachment') !== -1) {
        const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
        const matches = filenameRegex.exec(disposition);
        if (matches !== null && matches[1]) {
          filename = matches[1].replace(/['"]/g, '');
        }
      }

      if (!response.body) {
        throw new Error('Response body stream is not readable.');
      }

      if (hasSaveFilePicker) {
        let fileHandle;
        try {
          const picker = (
            window as Window & {
              showSaveFilePicker?: (options?: {
                suggestedName?: string;
                types?: { description?: string; accept?: Record<string, string[]> }[];
              }) => Promise<{ createWritable(): Promise<WritableStream> }>;
            }
          ).showSaveFilePicker;
          if (!picker) {
            throw new Error('showSaveFilePicker is not supported on this browser.');
          }
          fileHandle = await picker({
            suggestedName: filename,
            types: [
              {
                description: 'CSV Files',
                accept: { 'text/csv': ['.csv'] },
              },
            ],
          });
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') {
            // User cancelled the picker dialog. Exit gracefully.
            return { limited: false };
          }
          throw err;
        }

        const writableStream = await fileHandle.createWritable();
        await response.body.pipeTo(writableStream);
        return { limited: false };
      } else {
        // Fallback: Read chunks from stream and download as Blob
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            chunks.push(value);
          }
        }
        const blob = new Blob(chunks as BlobPart[], { type: 'text/csv; charset=utf-8' });

        // Dynamically determine if the export was truncated by counting lines
        // (Subtract 1 to account for the CSV header row)
        const text = await blob.text();
        const lineCount = text.split('\n').length - 1;
        const isLimited = lineCount >= 10000;

        // Trigger native browser download using temporary anchor tag
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        return { limited: isLimited };
      }
    } catch (err: unknown) {
      console.error('Database export CSV error:', err);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Database export timed out after 60 seconds.');
      }
      throw err instanceof Error
        ? err
        : new Error('An unexpected error occurred during database export.');
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const recordService = new RecordService();
