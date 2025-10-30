import logger from '@/utils/logger.js';

export type ValidationResult = {
  valid: boolean;
  reason?: 'not_found' | 'infra_error';
};

let cachedModels: string[] = [];
let lastUpdated = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function validateModelId(modelId: string): Promise<ValidationResult> {
  const now = Date.now();

  if (cachedModels.length > 0 && now - lastUpdated < CACHE_TTL_MS) {
    return {
      valid: cachedModels.includes(modelId),
      reason: cachedModels.includes(modelId) ? undefined : 'not_found',
    };
  }

  try {
    logger.info('Fetching model list from OpenRouter (refreshing cache)...');

    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) {
      logger.error(`Failed to fetch models from OpenRouter (status ${response.status})`);
      return { valid: false, reason: 'infra_error' };
    }

    //  Explicitly type the response
    const data = (await response.json()) as { data?: { id: string }[] };

    if (!data.data || !Array.isArray(data.data)) {
      logger.error('Unexpected response structure from OpenRouter');
      return { valid: false, reason: 'infra_error' };
    }

    //  Update cache
    cachedModels = data.data.map((m) => m.id);
    lastUpdated = now;

    return {
      valid: cachedModels.includes(modelId),
      reason: cachedModels.includes(modelId) ? undefined : 'not_found',
    };
  } catch (err) {
    logger.error('Error validating modelId from OpenRouter', { error: err });
    return { valid: false, reason: 'infra_error' };
  }
}
