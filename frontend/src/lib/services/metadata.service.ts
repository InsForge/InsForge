import { apiClient } from '@/lib/api/client';
import {
  ApiKeyResponse,
  AppMetadataSchema,
  DatabaseConnectionInfo,
  DatabasePasswordInfo,
} from '@insforge/shared-schemas';

export class MetadataService {
  async fetchApiKey(): Promise<string> {
    const data: ApiKeyResponse = await apiClient.request('/metadata/api-key');
    return data.apiKey;
  }

  async getFullMetadata(): Promise<AppMetadataSchema> {
    return apiClient.request('/metadata', {
      headers: apiClient.withAccessToken(),
    });
  }

  async getDatabaseConnectionString(): Promise<DatabaseConnectionInfo> {
    return apiClient.request('/metadata/database-connection-string', {
      headers: apiClient.withAccessToken(),
    });
  }

  async getDatabasePassword(): Promise<DatabasePasswordInfo> {
    return apiClient.request('/metadata/database-password', {
      headers: apiClient.withAccessToken(),
    });
  }
}

export const metadataService = new MetadataService();
