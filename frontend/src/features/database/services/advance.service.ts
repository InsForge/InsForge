import { apiClient } from '@/lib/api/client';

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
}

export const advanceService = new AdvanceService();
