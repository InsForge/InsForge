import { apiClient } from '@/lib/api/client';
import { AppMetadataSchema } from '@insforge/shared-schemas';

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
}

export const metadataService = new MetadataService();
