import { apiClient } from '#lib/api/client';
import type {
  CreateDatabaseBackupRequest,
  CreateDatabaseBackupResponse,
  DatabaseBackupConfigResponse,
  DatabaseBackupsResponse,
  DeleteDatabaseBackupResponse,
  GetDatabaseConfigResponse,
  RenameDatabaseBackupRequest,
  RestoreDatabaseBackupResponse,
  UpdateDatabaseBackupConfig,
  UpdateDatabaseConfigRequest,
  UpdateDatabaseConfigResponse,
  UpdateDatabaseBackupResponse,
} from '@insforge/shared-schemas';

export class BackupService {
  async listBackups(): Promise<DatabaseBackupsResponse> {
    return apiClient.request('/database/backups', {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
  }

  async createBackup(name?: string): Promise<CreateDatabaseBackupResponse> {
    const body: CreateDatabaseBackupRequest = name ? { name } : {};

    return apiClient.request('/database/backups', {
      method: 'POST',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    });
  }

  async renameBackup(backupId: string, name: string | null): Promise<UpdateDatabaseBackupResponse> {
    const body: RenameDatabaseBackupRequest = { name };

    return apiClient.request(`/database/backups/${backupId}`, {
      method: 'PATCH',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    });
  }

  async deleteBackup(backupId: string): Promise<DeleteDatabaseBackupResponse> {
    return apiClient.request(`/database/backups/${backupId}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken({}),
    });
  }

  async restoreBackup(backupId: string): Promise<RestoreDatabaseBackupResponse> {
    return apiClient.request(`/database/backups/${backupId}/restore`, {
      method: 'POST',
      headers: apiClient.withAccessToken({}),
    });
  }

  // Backup scheduling lives in the database-module config endpoint; these
  // helpers unwrap its `backup` section so callers stay flat.
  async getBackupConfig(): Promise<DatabaseBackupConfigResponse> {
    const response: GetDatabaseConfigResponse = await apiClient.request('/database/config', {
      method: 'GET',
      headers: apiClient.withAccessToken({}),
    });
    return response.backup;
  }

  async updateBackupConfig(
    patch: UpdateDatabaseBackupConfig
  ): Promise<DatabaseBackupConfigResponse> {
    const body: UpdateDatabaseConfigRequest = { backup: patch };
    const response: UpdateDatabaseConfigResponse = await apiClient.request('/database/config', {
      method: 'PATCH',
      headers: apiClient.withAccessToken({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(body),
    });
    return response.backup;
  }
}

export const backupService = new BackupService();
