import { apiClient } from '#lib/api/client';
import { buildDatabaseSchemaSearch, DEFAULT_DATABASE_SCHEMA } from '#features/database/helpers';
import type {
  DatabaseFunctionsResponse,
  DatabaseIndexesResponse,
  DatabasePoliciesResponse,
  DatabaseSchemasResponse,
  DatabaseTriggersResponse,
} from '@insforge/shared-schemas';

export class DatabaseService {
  async getSchemas(): Promise<DatabaseSchemasResponse> {
    return apiClient.request('/database/schemas', {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }

  /**
   * Get all database functions.
   * Requires admin privileges.
   */
  async getFunctions(
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ): Promise<DatabaseFunctionsResponse> {
    return apiClient.request(`/database/functions${buildDatabaseSchemaSearch(schemaName)}`, {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }

  /**
   * Get all database indexes.
   * Requires admin privileges.
   */
  async getIndexes(schemaName: string = DEFAULT_DATABASE_SCHEMA): Promise<DatabaseIndexesResponse> {
    return apiClient.request(`/database/indexes${buildDatabaseSchemaSearch(schemaName)}`, {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }

  /**
   * Get all RLS policies.
   * Requires admin privileges.
   */
  async getPolicies(
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ): Promise<DatabasePoliciesResponse> {
    return apiClient.request(`/database/policies${buildDatabaseSchemaSearch(schemaName)}`, {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }

  /**
   * Get all database triggers.
   * Requires admin privileges.
   */
  async getTriggers(
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ): Promise<DatabaseTriggersResponse> {
    return apiClient.request(`/database/triggers${buildDatabaseSchemaSearch(schemaName)}`, {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }
}

export const databaseService = new DatabaseService();
