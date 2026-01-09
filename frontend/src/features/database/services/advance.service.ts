import { apiClient } from '@/lib/api/client';
import { RawSQLRequest, RawSQLResponse } from '@insforge/shared-schemas';

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
