import { apiClient } from '#lib/api/client';
import type {
  CreateDatabaseBackupRequest,
  CreateDatabaseBackupResponse,
  DatabaseBackupsResponse,
  DeleteDatabaseBackupResponse,
  RenameDatabaseBackupRequest,
  RestoreDatabaseBackupResponse,
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
}

export const backupService = new BackupService();
