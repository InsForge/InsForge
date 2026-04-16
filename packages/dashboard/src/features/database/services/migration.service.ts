import { apiClient } from '../../../lib/api/client';
import type {
  CreateMigrationRequest,
  CreateMigrationResponse,
  DatabaseMigrationsResponse,
} from '@insforge/shared-schemas';

export class MigrationService {
  async listMigrations(): Promise<DatabaseMigrationsResponse> {
    return apiClient.request('/database/migrations', {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }

  async createMigration(body: CreateMigrationRequest): Promise<CreateMigrationResponse> {
    return apiClient.request('/database/migrations', {
      method: 'POST',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    });
  }
}

export const migrationService = new MigrationService();
