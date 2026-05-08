import { apiClient } from '#lib/api/client';
import type { DatabaseMigrationsResponse } from '@insforge/shared-schemas';

export class MigrationService {
  async listMigrations(): Promise<DatabaseMigrationsResponse> {
    return apiClient.request('/database/migrations', {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }
}

export const migrationService = new MigrationService();
