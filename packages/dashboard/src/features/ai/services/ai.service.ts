import { apiClient } from '#lib/api/client';
import { AIModelSchema, AIOverview, OpenRouterKey } from '@insforge/shared-schemas';

export type AIProvider = 'openrouter';

export class AIService {
  getModels(): Promise<AIModelSchema[]> {
    return apiClient.request('/ai/models', {
      headers: apiClient.withAccessToken(),
    });
  }

  getOverview(): Promise<AIOverview> {
    return apiClient.request('/ai/overview', {
      headers: apiClient.withAccessToken(),
    });
  }

  getProviderApiKey(provider: AIProvider): Promise<OpenRouterKey> {
    return apiClient.request(`/ai/${provider}/api-key`, {
      headers: apiClient.withAccessToken(),
    });
  }
}

export const aiService = new AIService();
