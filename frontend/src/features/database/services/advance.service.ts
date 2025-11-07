import { apiClient } from '@/lib/api/client';
import type { ExportDatabaseRequest, ExportDatabaseResponse } from '@insforge/shared-schemas';

export interface RawSQLRequest {
  query: string;
  params?: unknown[];
}

export interface RawSQLResponse {
  rows?: unknown[];
  rowCount?: number;
  fields?: Array<{ name: string; dataTypeID: number }>;
  success?: boolean;
  data?: unknown[];
  error?: string;
  message?: string;
}

export class AdvanceService {
  /**
   * Execute raw SQL query with strict sanitization.
   * Requires admin privileges.
   *
   * @param query - SQL query to execute
   * @param params - Optional query parameters
   * @returns Response with query results
   */
  async runRawSQL(query: string, params: unknown[] = []): Promise<RawSQLResponse> {
    const body: RawSQLRequest = { query, params };

    return apiClient.request('/database/advance/rawsql', {
      method: 'POST',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    });
  }

  /**
   * Get full database metadata including schema, functions, triggers, etc.
   * Requires admin privileges.
   *
   * @returns Response with complete database metadata in JSON format
   */
  async getDatabaseFullMetadata(): Promise<ExportDatabaseResponse> {
    const body: ExportDatabaseRequest = {
      format: 'json',
      includeData: false,
      includeFunctions: true,
      includeSequences: false,
      includeViews: false,
      rowLimit: 1000,
    };

    return apiClient.request('/database/advance/export', {
      method: 'POST',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    });
  }
}

export const advanceService = new AdvanceService();
