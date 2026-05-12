import type { RawOpenRouterModel } from '@/types/ai.js';
import type { AIModelSchema } from '@insforge/shared-schemas';
import { calculateTokenPrices, normalizeModalities, getProviderOrder } from './helpers.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';

const MODELS_CACHE_TTL_MS = 60 * 60 * 1000;
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=all';

let modelsCache: {
  expiresAt: number;
  models: AIModelSchema[];
} | null = null;

export class AIModelService {
  /**
   * Get all available AI models
   * Fetches the public OpenRouter catalog directly.
   */
  static async getModels(): Promise<AIModelSchema[]> {
    const now = Date.now();
    if (modelsCache && modelsCache.expiresAt > now) {
      return modelsCache.models;
    }

    const response = await fetch(OPENROUTER_MODELS_URL);

    if (!response.ok) {
      if (modelsCache) {
        return modelsCache.models;
      }
      throw new AppError(
        `Failed to fetch models: ${response.statusText}`,
        500,
        ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
      );
    }

    const data = (await response.json()) as { data: RawOpenRouterModel[] };
    const rawModels = data.data || [];

    const models: AIModelSchema[] = rawModels
      .map((rawModel) => {
        const inputModality = normalizeModalities(rawModel.architecture?.input_modalities || []);
        const outputModality = normalizeModalities(rawModel.architecture?.output_modalities || []);
        const { inputPrice, outputPrice, inputPriceLabel, outputPriceLabel } = calculateTokenPrices(
          rawModel.pricing,
          inputModality,
          outputModality
        );
        return {
          id: rawModel.id, // OpenRouter provided model ID
          created: rawModel.created,
          modelId: rawModel.id,
          provider: 'openrouter',
          inputModality,
          outputModality,
          inputPrice,
          outputPrice,
          inputPriceLabel,
          outputPriceLabel,
        };
      })
      .filter((model) => model.inputModality.length > 0 && model.outputModality.length > 0)
      .sort((a, b) => {
        const [aCompany = '', bCompany = ''] = [a.id.split('/')[0], b.id.split('/')[0]];

        const orderDiff = getProviderOrder(aCompany) - getProviderOrder(bCompany);
        return orderDiff !== 0 ? orderDiff : a.id.localeCompare(b.id);
      });

    modelsCache = {
      expiresAt: now + MODELS_CACHE_TTL_MS,
      models,
    };

    return models || [];
  }
}
