import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMock = vi.hoisted(() => ({
  request: vi.fn(),
  withAccessToken: vi.fn(() => ({ Authorization: 'Bearer token' })),
}));

vi.mock('#lib/api/client', () => ({
  apiClient: apiClientMock,
}));

import { AIService } from '#features/ai/services/ai.service';

describe('AIService', () => {
  let service: AIService;

  beforeEach(() => {
    apiClientMock.request.mockReset();
    apiClientMock.withAccessToken.mockClear();
    service = new AIService();
  });

  it('rotates the provider API key with an authenticated POST request', async () => {
    const rotatedKey = {
      apiKey: 'sk-or-rotated',
      maskedKey: 'sk-or-ro••••••••ated',
    };
    apiClientMock.request.mockResolvedValue(rotatedKey);

    await expect(service.rotateProviderApiKey('openrouter')).resolves.toEqual(rotatedKey);

    expect(apiClientMock.request).toHaveBeenCalledWith('/ai/openrouter/api-key/rotate', {
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
    });
  });
});
