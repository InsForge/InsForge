import logger from '@/utils/logger.js';

export type ValidationResult = {
  valid: boolean;
  reason?: 'not_found' | 'infra_error';
};

let cachedModels: string[] = [];
let lastUpdated = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;
let refreshPromise: Promise<string[]> | null = null;

export async function validateModelId(modelId: string): Promise<ValidationResult> {
  const now = Date.now();

  // Use cache if it's still fresh
  if (cachedModels.length > 0 && now - lastUpdated < CACHE_TTL_MS) {
    return {
      valid: cachedModels.includes(modelId),
      reason: cachedModels.includes(modelId) ? undefined : 'not_found',
    };
  }

  // Wait for an ongoing refresh if one exists
  if (refreshPromise) {
    cachedModels = await refreshPromise;
    return {
      valid: cachedModels.includes(modelId),
      reason: cachedModels.includes(modelId) ? undefined : 'not_found',
    };
  }

  // Otherwise, start a new refresh
  let hadError = false;
  refreshPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      logger.info('Fetching model list from OpenRouter (refreshing cache)...');
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.error(`Failed to fetch models from OpenRouter (status ${response.status})`);
        throw new Error('infra_error');
      }

      const data = (await response.json()) as { data?: { id: string }[] };

      if (!data.data || !Array.isArray(data.data)) {
        logger.error('Unexpected response structure from OpenRouter');
        throw new Error('infra_error');
      }

      cachedModels = data.data.map((m) => m.id);
      lastUpdated = Date.now();
      return cachedModels;
    } catch (err) {
      hadError = true;
      if (err instanceof Error && err.name === 'AbortError') {
        logger.warn('Timeout validating modelId with OpenRouter', { modelId });
      } else {
        logger.error('Error validating modelId from OpenRouter', { error: err });
      }
      return cachedModels; // return previous cache if available
    } finally {
      refreshPromise = null;
    }
  })();

  cachedModels = await refreshPromise;

  // ✅ Handle case: infra failure + empty cache
  if (hadError && cachedModels.length === 0) {
    return { valid: false, reason: 'infra_error' };
  }

  return {
    valid: cachedModels.includes(modelId),
    reason: cachedModels.includes(modelId) ? undefined : 'not_found',
  };
}
