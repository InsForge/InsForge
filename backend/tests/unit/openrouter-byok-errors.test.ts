import { beforeEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';

// Mock dependencies before imports
const { mockGetApiKeyWithSource, mockGetClient, mockRenewCloudApiKey } = vi.hoisted(() => ({
  mockGetApiKeyWithSource: vi.fn(),
  mockGetClient: vi.fn(),
  mockRenewCloudApiKey: vi.fn(),
}));

vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: () => false,
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: { getInstance: () => ({ getSecret: vi.fn(), setSecret: vi.fn() }) },
}));

// Import after mocks
import { OpenRouterProvider } from '../../src/providers/ai/openrouter.provider.js';
import { ERROR_CODES } from '../../src/types/error-constants.js';

function createAPIError(status: number, message: string): OpenAI.APIError {
  return new OpenAI.APIError(status, { message }, message, new Headers());
}

describe('OpenRouterProvider — BYOK error handling', () => {
  let provider: OpenRouterProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = OpenRouterProvider.getInstance();

    // Patch private methods for testing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = provider as Record<string, any>;
    p.getApiKeyWithSource = mockGetApiKeyWithSource;
    p.getClient = mockGetClient.mockResolvedValue(new OpenAI({ apiKey: 'test' }));
    p.renewCloudApiKey = mockRenewCloudApiKey;
  });

  it('throws AppError with AI_INVALID_API_KEY for BYOK 401', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'byok-key', source: 'byok' });

    await expect(
      provider.sendRequest(() => {
        throw createAPIError(401, 'Unauthorized');
      })
    ).rejects.toMatchObject({
      statusCode: 401,
      code: ERROR_CODES.AI_INVALID_API_KEY,
      message: expect.stringContaining('BYOK API key is invalid'),
    });
  });

  it('throws AppError with AI_INVALID_API_KEY for BYOK 403', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'byok-key', source: 'byok' });

    await expect(
      provider.sendRequest(() => {
        throw createAPIError(403, 'Forbidden');
      })
    ).rejects.toMatchObject({
      statusCode: 401,
      code: ERROR_CODES.AI_INVALID_API_KEY,
      message: expect.stringContaining('BYOK API key is invalid'),
    });
  });

  it('throws AppError with RATE_LIMITED for 429', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'byok-key', source: 'byok' });

    await expect(
      provider.sendRequest(() => {
        throw createAPIError(429, 'Rate limited');
      })
    ).rejects.toMatchObject({
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
      message: expect.stringContaining('rate limit exceeded'),
    });
  });

  it('throws AppError with generic message for env key 401', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });

    await expect(
      provider.sendRequest(() => {
        throw createAPIError(401, 'Unauthorized');
      })
    ).rejects.toMatchObject({
      statusCode: 401,
      code: ERROR_CODES.AI_INVALID_API_KEY,
      message: expect.stringContaining('authentication failed'),
    });
  });

  it('still throws raw error for non-API errors', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'byok-key', source: 'byok' });

    const networkError = new Error('ECONNREFUSED');

    await expect(
      provider.sendRequest(() => {
        throw networkError;
      })
    ).rejects.toBe(networkError);
  });

  it('still throws raw error for 500 API errors', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'byok-key', source: 'byok' });

    await expect(
      provider.sendRequest(() => {
        throw createAPIError(500, 'Internal Server Error');
      })
    ).rejects.toBeInstanceOf(OpenAI.APIError);
  });
});
