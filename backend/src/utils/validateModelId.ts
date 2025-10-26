import logger from './logger';

interface OpenRouterModel {
  id: string;
}

interface OpenRouterResponse {
  data: OpenRouterModel[];
}

export async function validateModelId(modelId: string): Promise<boolean> {
  if (!process.env.OPENROUTER_API_KEY) {
    logger.error('OPENROUTER_API_KEY environment variable is not set');
    return false;
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
      return false;
    }

    const data: unknown = await response.json();

    if (typeof data !== 'object' || data === null) {
      logger.warn('Unexpected response structure from OpenRouter');
      return false;
    }

    const responseData = data as OpenRouterResponse;
    if (!Array.isArray(responseData.data)) {
      logger.warn('Unexpected response structure from OpenRouter');
      return false;
    }

    return responseData.data.some((m) => typeof m.id === 'string' && m.id === modelId);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('Timeout validating modelId with OpenRouter', { modelId });
    } else {
      logger.error('Error validating modelId', { error: err, modelId });
    }
    return false;
  }
}
