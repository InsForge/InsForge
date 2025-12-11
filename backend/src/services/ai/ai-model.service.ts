import { isCloudEnvironment } from '@/utils/environment.js';
import { OpenRouterProvider } from '@/providers/ai/openrouter.provider.js';
import type { RawOpenRouterModel } from '@/types/ai.js';
import type { AIModelSchema } from '@insforge/shared-schemas';
import { calculatePriceLevel, filterAndSortModalities, getProviderOrder } from './helpers.js';

export class AIModelService {
  /**
   * Get all available AI models
   * Fetches from cloud API if in cloud environment, otherwise from OpenRouter directly
   */
  static async getModels(): Promise<AIModelSchema[]> {
    const openRouterProvider = OpenRouterProvider.getInstance();
    const configured = openRouterProvider.isConfigured();

    if (!configured) {
      return [];
    }

    // Get API key from OpenRouter provider
    const apiKey = await openRouterProvider.getApiKey();

    // Determine the API endpoint based on environment
    const apiUrl = isCloudEnvironment()
      ? 'https://api.insforge.dev/ai/v1/models'
      : 'https://openrouter.ai/api/v1/models/user';

    // Fetch models from the appropriate endpoint
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = (await response.json()) as { data: RawOpenRouterModel[] };
    const rawModels = data.data || [];

    const models: AIModelSchema[] = rawModels
      .map((rawModel) => ({
        id: rawModel.id, // OpenRouter provided model ID
        modelId: rawModel.id,
        provider: 'openrouter',
        inputModality: filterAndSortModalities(rawModel.architecture?.input_modalities || []),
        outputModality: filterAndSortModalities(rawModel.architecture?.output_modalities || []),
        priceLevel: calculatePriceLevel(rawModel.pricing),
      }))
      .sort((a, b) => {
        const [aCompany = '', bCompany = ''] = [a.id.split('/')[0], b.id.split('/')[0]];

        const orderDiff = getProviderOrder(aCompany) - getProviderOrder(bCompany);
        return orderDiff !== 0 ? orderDiff : a.id.localeCompare(b.id);
      });

    return models || [];
  }
}
