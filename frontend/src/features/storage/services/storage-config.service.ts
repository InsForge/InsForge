import { apiClient } from '@/lib/api/client';
import { StorageConfigSchema, UpdateStorageConfigRequest } from '@insforge/shared-schemas';

export class StorageConfigService {
  async getConfig(): Promise<StorageConfigSchema> {
    return apiClient.request('/storage/config');
  }

  async updateConfig(config: UpdateStorageConfigRequest): Promise<StorageConfigSchema> {
    return apiClient.request('/storage/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }
}

export const storageConfigService = new StorageConfigService();
