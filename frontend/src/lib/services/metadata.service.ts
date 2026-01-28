import { apiClient } from '@/lib/api/client';
import {
  ApiKeyResponse,
  AppMetadataSchema,
  DatabaseConnectionInfo,
  DatabasePasswordInfo,
} from '@insforge/shared-schemas';

export interface RotateApiKeyResponse {
  success: boolean;
  message: string;
  apiKey: string;
  oldKeyExpiresAt: string;
}

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

  async rotateApiKey(gracePeriodHours: number = 24): Promise<RotateApiKeyResponse> {
    return apiClient.request('/secrets/api-key/rotate', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify({ gracePeriodHours }),
    });
  }
}

export const metadataService = new MetadataService();
