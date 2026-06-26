import { beforeEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';

const { mockGetApiKeyWithSource, mockGetClient } = vi.hoisted(() => ({
  mockGetApiKeyWithSource: vi.fn(),
  mockGetClient: vi.fn(),
}));

vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: () => false,
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { OpenRouterProvider } from '../../src/providers/ai/openrouter.provider.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

function createAPIError(status: number, message: string): OpenAI.APIError {
  return new OpenAI.APIError(status, { message }, message, new Headers());
}

describe('OpenRouterProvider authentication error handling', () => {
  let provider: OpenRouterProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = OpenRouterProvider.getInstance();

    // Patch private methods for focused provider error tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = provider as Record<string, any>;
    p.getApiKeyWithSource = mockGetApiKeyWithSource;
    p.getClient = mockGetClient.mockResolvedValue(new OpenAI({ apiKey: 'test' }));
  });

  it('throws AppError with BILLING_INSUFFICIENT_BALANCE for cloud key 402 without renewing', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'cloud-key', source: 'cloud' });

    await expect(
      provider.sendRequest(() => {
        throw createAPIError(402, 'Insufficient credits');
      })
    ).rejects.toMatchObject({
      statusCode: 402,
      code: ERROR_CODES.BILLING_INSUFFICIENT_BALANCE,
      nextActions: expect.stringContaining('Upgrade your plan'),
    });
  });

  it('throws AppError with BILLING_INSUFFICIENT_BALANCE for env key 402', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });

    await expect(
      provider.sendRequest(() => {
        throw createAPIError(402, 'Insufficient credits');
      })
    ).rejects.toMatchObject({
      statusCode: 402,
      code: ERROR_CODES.BILLING_INSUFFICIENT_BALANCE,
      nextActions: expect.stringContaining('OpenRouter account'),
    });
  });

  it('throws AppError with AI_INVALID_API_KEY for env key 401', async () => {
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

  it('throws AppError with AI_INVALID_API_KEY for env key 403', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });

    await expect(
      provider.sendRequest(() => {
        throw createAPIError(403, 'Forbidden');
      })
    ).rejects.toMatchObject({
      statusCode: 401,
      code: ERROR_CODES.AI_INVALID_API_KEY,
      nextActions: expect.stringContaining('OPENROUTER_API_KEY'),
    });
  });

  it('throws AppError with RATE_LIMITED for 429', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });

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

  it('maps non-API provider errors to AI_UPSTREAM_UNAVAILABLE', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });

    const networkError = new Error('ECONNREFUSED');

    await expect(
      provider.sendRequest(() => {
        throw networkError;
      })
    ).rejects.toMatchObject({
      statusCode: 502,
      code: ERROR_CODES.AI_UPSTREAM_UNAVAILABLE,
      message: 'ECONNREFUSED',
    });
  });

  it('maps 500 API errors to AI_UPSTREAM_UNAVAILABLE', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });

    await expect(
      provider.sendRequest(() => {
        throw createAPIError(500, 'Internal Server Error');
      })
    ).rejects.toMatchObject({
      statusCode: 500,
      code: ERROR_CODES.AI_UPSTREAM_UNAVAILABLE,
      message: expect.stringContaining('Internal Server Error'),
    });
  });
});
