import type { RawOpenRouterModel } from '@/types/ai.js';
import { ERROR_CODES, type AIModelSchema } from '@insforge/shared-schemas';
import { calculateTokenPrices, normalizeModalities, getProviderOrder } from './helpers.js';
import { AppError } from '@/utils/errors.js';
import { logger } from '@/utils/logger.js';

const MODELS_CACHE_TTL_MS = 60 * 60 * 1000;
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=all';

let modelsCache: {
  expiresAt: number;
  models: AIModelSchema[];
} | null = null;

/**
 * Tracks an in-flight request to the OpenRouter model catalog.
 * Used to deduplicate concurrent cache-miss requests and prevent cache stampedes.
 */
let fetchInFlight: Promise<AIModelSchema[]> | null = null;

let circuitBreakerUntil = 0;

export class AIModelService {
  /**
   * Retrieves the catalog of available AI models from OpenRouter.
   * Utilizes a time-based cache and coalesces concurrent fetches to prevent rate limiting.
   * @returns {Promise<AIModelSchema[]>} A promise resolving to an array of available models.
   */
  static async getModels(): Promise<AIModelSchema[]> {
    if (Date.now() < circuitBreakerUntil) {
      throw new AppError(
        'Upstream AI models catalog is temporarily unavailable.',
        503,
        ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
      );
    }

    if (modelsCache && modelsCache.expiresAt > Date.now()) {
      return modelsCache.models;
    }

    if (fetchInFlight) {
      return fetchInFlight;
    }

    fetchInFlight = (async () => {
      try {
        const response = await fetch(OPENROUTER_MODELS_URL);

        if (!response.ok) {
          throw new AppError(
            `Failed to fetch models: ${response.statusText}`,
            503,
            ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
          );
        }

        const data = (await response.json()) as { data: RawOpenRouterModel[] };
        const rawModels = data.data || [];

        const models: AIModelSchema[] = rawModels
          .map((rawModel) => {
            const inputModality = normalizeModalities(
              rawModel.architecture?.input_modalities || []
            );
            const outputModality = normalizeModalities(
              rawModel.architecture?.output_modalities || []
            );
            const { inputPrice, outputPrice, inputPriceLabel, outputPriceLabel } =
              calculateTokenPrices(rawModel.pricing, inputModality, outputModality);
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
          expiresAt: Date.now() + MODELS_CACHE_TTL_MS,
          models,
        };

        return models;
      } catch (err) {
        if (modelsCache) {
          logger.warn('OpenRouter catalog fetch failed; serving stale cache.', { err });
          modelsCache.expiresAt = Date.now() + 5000;
          return modelsCache.models;
        }
        logger.warn('OpenRouter catalog fetch failed; opening circuit breaker.', { err });
        circuitBreakerUntil = Date.now() + 5000;
        throw err instanceof AppError
          ? err
          : new AppError(
              'Upstream AI models catalog is temporarily unavailable.',
              503,
              ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
            );
      }
    })().finally(() => {
      fetchInFlight = null;
    });

    return fetchInFlight;
  }
}

/**
 * Test helper to reset module-level cache and in-flight tracking state.
 * Strictly for use in unit test isolation.
 */
export function _resetCacheForTesting() {
  modelsCache = null;
  fetchInFlight = null;
  circuitBreakerUntil = 0;
}
