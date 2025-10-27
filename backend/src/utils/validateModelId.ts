import logger from './logger';

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: 'not_found' | 'network_error' | 'timeout' | 'missing_api_key' };

interface OpenRouterModel {
  id: string;
}

interface OpenRouterResponse {
  data: OpenRouterModel[];
}

export async function validateModelId(modelId: string): Promise<ValidationResult> {
  if (!process.env.OPENROUTER_API_KEY) {
    logger.error('OPENROUTER_API_KEY environment variable is not set');
    return { valid: false, reason: 'missing_api_key' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn('Failed to fetch models from OpenRouter', { statusCode: response.status });
      return { valid: false, reason: 'network_error' };
    }

    const data: unknown = await response.json();

    if (typeof data !== 'object' || data === null) {
      logger.warn('Unexpected response structure from OpenRouter');
      return { valid: false, reason: 'network_error' };
    }

    const responseData = data as OpenRouterResponse;

    if (!Array.isArray(responseData.data)) {
      logger.warn('Unexpected response structure from OpenRouter');
      return { valid: false, reason: 'network_error' };
    }

    const found = responseData.data.some((m) => typeof m.id === 'string' && m.id === modelId);
    return found ? { valid: true } : { valid: false, reason: 'not_found' };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('Timeout validating modelId with OpenRouter', { modelId });
      return { valid: false, reason: 'timeout' };
    } else {
      logger.error('Error validating modelId', { error: err, modelId });
      return { valid: false, reason: 'network_error' };
    }
  }
}
