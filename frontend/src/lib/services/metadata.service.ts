import { apiClient } from '@/lib/api/client';
import { AppMetadataSchema } from '@insforge/shared-schemas';

// TODO: Replace with schema from shared-schemas
export interface DatabaseConnectionInfo {
  connectionURL: string;
  parameters: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    sslmode: string;
  };
}

export interface DatabasePasswordInfo {
  databasePassword: string;
}

export class MetadataService {
  async fetchApiKey() {
    const data = await apiClient.request('/metadata/api-key');
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
