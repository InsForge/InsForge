import { apiClient } from '#lib/api/client';
import { buildDatabaseSchemaSearch, DEFAULT_DATABASE_SCHEMA } from '#features/database/helpers';
import {
  ColumnSchema,
  CreateTableRequest,
  type ForeignKeySchema,
  GetTableSchemaResponse,
  TableRlsStatus,
  UpdateTableSchemaRequest,
  UpdateTableSchemaResponse,
} from '@insforge/shared-schemas';

/**
 * Dashboard client service for table management, schema queries, and RLS operations.
 */
export class TableService {
  /**
   * Lists all table names in the specified schema.
   *
   * @param schemaName - Database schema name (defaults to 'public')
   * @param signal - Optional AbortSignal for request cancellation
   * @returns Array of table names
   */
  async listTables(
    schemaName: string = DEFAULT_DATABASE_SCHEMA,
    signal?: AbortSignal
  ): Promise<string[]> {
    return await apiClient.request(`/database/tables${buildDatabaseSchemaSearch(schemaName)}`, {
      headers: apiClient.withAccessToken(),
      signal,
    });
  }

  /**
   * Fetches lightweight Row Level Security (RLS) status for all tables in a schema.
   *
   * @param schemaName - Database schema name (defaults to 'public')
   * @param signal - Optional AbortSignal for request cancellation
   * @returns Array of table RLS status records
   */
  getTableRlsStatuses(
    schemaName: string = DEFAULT_DATABASE_SCHEMA,
    signal?: AbortSignal
  ): Promise<TableRlsStatus[]> {
    return apiClient.request(
      `/database/tables/rls-status${buildDatabaseSchemaSearch(schemaName)}`,
      {
        headers: apiClient.withAccessToken(),
        signal,
      }
    );
  }

  /**
   * Retrieves the full schema definition and metadata for a specific table.
   *
   * @param tableName - Name of the table
   * @param schemaName - Database schema name (defaults to 'public')
   * @param signal - Optional AbortSignal for request cancellation
   * @returns Detailed table schema response
   */
  getTableSchema(
    tableName: string,
    schemaName: string = DEFAULT_DATABASE_SCHEMA,
    signal?: AbortSignal
  ): Promise<GetTableSchemaResponse> {
    return apiClient.request(
      `/database/tables/${encodeURIComponent(tableName)}/schema${buildDatabaseSchemaSearch(schemaName)}`,
      {
        headers: apiClient.withAccessToken(),
        signal,
      }
    );
  }

  /**
   * Creates a new database table with the provided column and foreign key definitions.
   *
   * @param schemaName - Target database schema name
   * @param tableName - Name of the new table
   * @param columns - Array of column definitions
   * @param foreignKeys - Optional array of foreign key definitions
   * @returns Created table schema response
   */
  createTable(
    schemaName: string,
    tableName: string,
    columns: ColumnSchema[],
    foreignKeys: ForeignKeySchema[] = []
  ) {
    const body: CreateTableRequest = { tableName, columns, foreignKeys, rlsEnabled: true };

    return apiClient.request(`/database/tables${buildDatabaseSchemaSearch(schemaName)}`, {
      method: 'POST',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    });
  }

  /**
   * Deletes a database table and its dependent relations.
   *
   * @param tableName - Name of the table to delete
   * @param schemaName - Database schema name (defaults to 'public')
   * @returns Deletion confirmation response
   */
  deleteTable(tableName: string, schemaName: string = DEFAULT_DATABASE_SCHEMA) {
    return apiClient.request(
      `/database/tables/${encodeURIComponent(tableName)}${buildDatabaseSchemaSearch(schemaName)}`,
      {
        method: 'DELETE',
        headers: apiClient.withAccessToken(),
      }
    );
  }

  /**
   * Enables Row Level Security on the specified table.
   *
   * @param tableName - Name of the table
   * @param schemaName - Database schema name (defaults to 'public')
   * @returns Confirmation object with updated RLS status
   */
  enableTableRLS(
    tableName: string,
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ): Promise<{ schemaName: string; tableName: string; rlsEnabled: boolean; message: string }> {
    return apiClient.request(
      `/database/tables/${encodeURIComponent(tableName)}/enable-rls${buildDatabaseSchemaSearch(schemaName)}`,
      {
        method: 'POST',
        headers: apiClient.withAccessToken(),
      }
    );
  }

  /**
   * Modifies an existing table's schema (columns, foreign keys, or table rename).
   *
   * @param tableName - Name of the table to modify
   * @param operations - Schema update operations conforming to UpdateTableSchemaRequest
   * @param schemaName - Database schema name (defaults to 'public')
   * @returns Updated table schema response
   */
  updateTableSchema(
    tableName: string,
    operations: UpdateTableSchemaRequest,
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ): Promise<UpdateTableSchemaResponse | void> {
    return apiClient.request(
      `/database/tables/${encodeURIComponent(tableName)}/schema${buildDatabaseSchemaSearch(schemaName)}`,
      {
        method: 'PATCH',
        headers: apiClient.withAccessToken({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(operations),
      }
    );
  }
}

export const tableService = new TableService();
