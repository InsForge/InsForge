import { apiClient } from '#lib/api/client';
import { AIModelSchema, AIOverview, OpenRouterKey } from '@insforge/shared-schemas';

export class AIService {
  getModels(): Promise<AIModelSchema[]> {
    return apiClient.request('/ai/models', {
      headers: apiClient.withAccessToken(),
    });
  }

  getOverview(range: string = '1m'): Promise<AIOverview> {
    return apiClient.request(`/ai/overview?range=${encodeURIComponent(range)}`, {
      headers: apiClient.withAccessToken(),
    });
  }

  getOpenRouterKey(): Promise<OpenRouterKey> {
    return apiClient.request('/ai/openrouter-key', {
      headers: apiClient.withAccessToken(),
    });
  }

  async getRemainingCredits(): Promise<{
    usage: number;
    limit: number | null;
    remaining: number | null;
  }> {
    return apiClient.request('/ai/credits', {
      headers: apiClient.withAccessToken(),
    });
  }
}

export const aiService = new AIService();
