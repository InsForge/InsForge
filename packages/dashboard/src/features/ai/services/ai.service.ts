import { apiClient } from '#lib/api/client';
import {
  AIModelSchema,
  AIOverview,
  ModelGatewayConfig,
  OpenRouterKey,
  UpdateModelGatewayConfig,
} from '@insforge/shared-schemas';

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

  getConfig(): Promise<ModelGatewayConfig> {
    return apiClient.request('/ai/config', {
      headers: apiClient.withAccessToken(),
    });
  }

  updateConfig(input: UpdateModelGatewayConfig): Promise<ModelGatewayConfig> {
    return apiClient.request('/ai/config', {
      method: 'PUT',
      headers: apiClient.withAccessToken(),
      body: JSON.stringify(input),
    });
  }

  getProviderApiKey(provider: AIProvider): Promise<OpenRouterKey> {
    return apiClient.request(`/ai/${provider}/api-key`, {
      headers: apiClient.withAccessToken(),
    });
  }

  rotateProviderApiKey(provider: AIProvider): Promise<OpenRouterKey> {
    return apiClient.request(`/ai/${provider}/api-key/rotate`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  }
}

export const aiService = new AIService();
