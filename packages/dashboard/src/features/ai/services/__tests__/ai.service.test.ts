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

  it('loads and updates Model Gateway configuration through authenticated requests', async () => {
    const config = {
      apiKey: { configured: true, source: 'environment', maskedKey: 'sk-or••••' },
      managementKey: { configured: false, source: null, maskedKey: null },
    };
    apiClientMock.request.mockResolvedValue(config);

    await expect(service.getConfig()).resolves.toEqual(config);
    await expect(service.updateConfig({ managementKey: 'management-key' })).resolves.toEqual(
      config
    );

    expect(apiClientMock.request).toHaveBeenNthCalledWith(1, '/ai/config', {
      headers: { Authorization: 'Bearer token' },
    });
    expect(apiClientMock.request).toHaveBeenNthCalledWith(2, '/ai/config', {
      method: 'PUT',
      headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ managementKey: 'management-key' }),
    });
  });
});
