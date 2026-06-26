import { apiClient } from '#lib/api/client';
import {
  AnonKeyResponse,
  ApiKeyResponse,
  AppMetadataSchema,
  DatabaseConnectionInfo,
  DatabasePasswordInfo,
  ProjectIdResponse,
  RotateAnonKeyResponse,
  RotateApiKeyResponse,
} from '@insforge/shared-schemas';

export class MetadataService {
  async fetchApiKey(signal?: AbortSignal): Promise<string> {
    const data: ApiKeyResponse = await apiClient.request('/metadata/api-key', { signal });
    return data.apiKey;
  }

  async fetchAnonKey(signal?: AbortSignal): Promise<string> {
    const data: AnonKeyResponse = await apiClient.request('/metadata/anon-key', { signal });
    return data.anonKey;
  }

  async fetchProjectId(signal?: AbortSignal): Promise<string | null> {
    const data: ProjectIdResponse = await apiClient.request('/metadata/project-id', {
      headers: apiClient.withAccessToken(),
      signal,
    });
    return data.projectId;
  }

  async getFullMetadata(signal?: AbortSignal): Promise<AppMetadataSchema> {
    return apiClient.request('/metadata', {
      headers: apiClient.withAccessToken(),
      signal,
    });
  }

  async getDatabaseConnectionString(signal?: AbortSignal): Promise<DatabaseConnectionInfo> {
    return apiClient.request('/metadata/database-connection-string', {
      headers: apiClient.withAccessToken(),
      signal,
    });
  }

  async getDatabasePassword(signal?: AbortSignal): Promise<DatabasePasswordInfo> {
    return apiClient.request('/metadata/database-password', {
      headers: apiClient.withAccessToken(),
      signal,
    });
  }

  async rotateApiKey(gracePeriodHours: number = 24): Promise<RotateApiKeyResponse> {
    return apiClient.request('/secrets/api-key/rotate', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify({ gracePeriodHours }),
    });
  }

  async rotateAnonKey(gracePeriodHours: number = 168): Promise<RotateAnonKeyResponse> {
    return apiClient.request('/secrets/anon-key/rotate', {
      method: 'POST',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify({ gracePeriodHours }),
    });
  }
}

export const metadataService = new MetadataService();
