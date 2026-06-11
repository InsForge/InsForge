import { apiClient } from '#lib/api/client';
import { ExplainSQLResponse, RawSQLRequest, RawSQLResponse } from '@insforge/shared-schemas';

export class AdvanceService {
  /**
   * Execute raw SQL query with project_admin database privileges.
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
   * Execute EXPLAIN ANALYZE for a SQL query with project_admin database privileges.
   * Mutating statements are rolled back by the backend.
   */
  async explainSQL(query: string, params: unknown[] = []): Promise<ExplainSQLResponse> {
    const body: RawSQLRequest = { query, params };

    return apiClient.request('/database/advance/rawsql/explain', {
      method: 'POST',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    });
  }
}

export const advanceService = new AdvanceService();
