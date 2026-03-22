import { apiClient } from '@/lib/api/client';
import { AIAccessConfigSchema, UpdateAIAccessConfigRequest } from '@insforge/shared-schemas';

/** Client-side service for interacting with the AI access configuration API. */
export class AIAccessConfigService {
  /** Fetches the current AI access configuration from the server. */
  async getConfig(): Promise<AIAccessConfigSchema> {
    return apiClient.request('/ai/config', {
      headers: apiClient.withAccessToken(),
    });
  }

  /** Persists an updated AI access configuration to the server. */
  async updateConfig(config: UpdateAIAccessConfigRequest): Promise<AIAccessConfigSchema> {
    return apiClient.request('/ai/config', {
      method: 'PUT',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(config),
    });
  }
}

export const aiAccessConfigService = new AIAccessConfigService();
