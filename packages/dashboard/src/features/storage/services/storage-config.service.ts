import { apiClient } from '#lib/api/client';
import { StorageConfigSchema, UpdateStorageConfigRequest } from '@insforge/shared-schemas';

/** Client-side service for interacting with the storage configuration API. */
export class StorageConfigService {
  /** Fetches the current storage configuration from the server. */
  async getConfig(): Promise<StorageConfigSchema> {
    return apiClient.request('/storage/config');
  }

  /** Persists an updated storage configuration to the server. */
  async updateConfig(config: UpdateStorageConfigRequest): Promise<StorageConfigSchema> {
    return apiClient.request('/storage/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }
}

export const storageConfigService = new StorageConfigService();
