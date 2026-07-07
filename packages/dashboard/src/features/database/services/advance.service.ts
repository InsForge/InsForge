import { apiClient } from '#lib/api/client';
import { RawSQLRequest, RawSQLResponse } from '@insforge/shared-schemas';

export class AdvanceService {
  /**
   * Execute raw SQL query with project_admin database privileges.
   * Requires admin privileges.
   *
   * @param query - SQL query to execute
   * @param params - Optional query parameters
   * @returns Response with query results
   */
  async runRawSQL(
    query: string,
    params: unknown[] = [],
    explain?: boolean
  ): Promise<RawSQLResponse> {
    const body: RawSQLRequest = { query, params, explain };

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
