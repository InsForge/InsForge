import { isCloudEnvironment } from '@/utils/environment.js';
import { OpenRouterProvider } from '@/providers/ai/openrouter.provider.js';
import { MiniMaxProvider } from '@/providers/ai/minimax.provider.js';
import type { RawOpenRouterModel } from '@/types/ai.js';
import type { AIModelSchema } from '@insforge/shared-schemas';
import { calculatePricePerMillion, filterAndSortModalities, getProviderOrder } from './helpers.js';
import logger from '@/utils/logger.js';

export class AIModelService {
  /**
   * Get all available AI models from all configured providers
   */
  static async getModels(): Promise<AIModelSchema[]> {
    const models: AIModelSchema[] = [];

    // Fetch OpenRouter models
    const openRouterModels = await AIModelService.getOpenRouterModels();
    models.push(...openRouterModels);

    // Add MiniMax models if configured
    const minimaxModels = AIModelService.getMiniMaxModels();
    models.push(...minimaxModels);

    return models;
  }

  /**
   * Fetch models from OpenRouter API
   */
  private static async getOpenRouterModels(): Promise<AIModelSchema[]> {
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

    return rawModels
      .map((rawModel) => {
        const { inputPrice, outputPrice } = calculatePricePerMillion(rawModel.pricing);
        return {
          id: rawModel.id, // OpenRouter provided model ID
          modelId: rawModel.id,
          provider: 'openrouter',
          inputModality: filterAndSortModalities(rawModel.architecture?.input_modalities || []),
          outputModality: filterAndSortModalities(rawModel.architecture?.output_modalities || []),
          inputPrice,
          outputPrice,
        };
      })
      .sort((a, b) => {
        const [aCompany = '', bCompany = ''] = [a.id.split('/')[0], b.id.split('/')[0]];

        const orderDiff = getProviderOrder(aCompany) - getProviderOrder(bCompany);
        return orderDiff !== 0 ? orderDiff : a.id.localeCompare(b.id);
      });
  }

  /**
   * Get available MiniMax models (static list since MiniMax uses direct API)
   * MiniMax offers OpenAI-compatible API with 204K context window
   */
  private static getMiniMaxModels(): AIModelSchema[] {
    const minimaxProvider = MiniMaxProvider.getInstance();
    if (!minimaxProvider.isConfigured()) {
      return [];
    }

    logger.info('MiniMax API key configured, adding MiniMax models');

    return [
      {
        id: 'MiniMax-M2.5',
        modelId: 'MiniMax-M2.5',
        provider: 'minimax',
        inputModality: ['text'],
        outputModality: ['text'],
        inputPrice: 0.8,
        outputPrice: 3.2,
      },
      {
        id: 'MiniMax-M2.5-highspeed',
        modelId: 'MiniMax-M2.5-highspeed',
        provider: 'minimax',
        inputModality: ['text'],
        outputModality: ['text'],
        inputPrice: 0.8,
        outputPrice: 3.2,
      },
    ];
  }
}
