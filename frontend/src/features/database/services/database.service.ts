import { apiClient } from '@/lib/api/client';
import type {
  DatabaseFunctionsResponse,
  DatabaseIndexesResponse,
  DatabasePoliciesResponse,
  DatabaseTriggersResponse,
} from '@insforge/shared-schemas';

export class DatabaseService {
  /**
   * Get all database functions.
   * Requires admin privileges.
   */
  async getFunctions(): Promise<DatabaseFunctionsResponse> {
    return apiClient.request('/database/functions', {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }

  /**
   * Get all database indexes.
   * Requires admin privileges.
   */
  async getIndexes(): Promise<DatabaseIndexesResponse> {
    return apiClient.request('/database/indexes', {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }

  /**
   * Get all RLS policies.
   * Requires admin privileges.
   */
  async getPolicies(): Promise<DatabasePoliciesResponse> {
    return apiClient.request('/database/policies', {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }

  /**
   * Get all database triggers.
   * Requires admin privileges.
   */
  async getTriggers(): Promise<DatabaseTriggersResponse> {
    return apiClient.request('/database/triggers', {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }
}

export const databaseService = new DatabaseService();
