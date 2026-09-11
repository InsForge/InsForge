import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

import { AIModelService, _resetCacheForTesting } from '../../src/services/ai/ai-model.service';

describe('AIModelService', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetCacheForTesting();
  });

  // Suite-level safety net: a test that reaches for fake timers and throws
  // mid-assertion would otherwise leak them into every later test in the same
  // worker.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches the public OpenRouter catalog with all output modalities and caches it', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: 'openai/gpt-image',
              created: 1767225600,
              architecture: {
                input_modalities: ['image', 'text'],
                output_modalities: ['video', 'text', 'embeddings'],
              },
              pricing: {
                prompt: '0.000001',
                completion: '0.000002',
                image: '0.02',
              },
            },
            {
              id: 'openai/whisper-large-v3',
              created: 1777248000,
              architecture: {
                input_modalities: ['audio'],
                output_modalities: ['transcription'],
              },
              pricing: {
                prompt: '0.111',
                completion: '0',
              },
            },
            {
              id: 'google/veo',
              created: 1777334400,
              architecture: {
                input_modalities: ['text'],
                output_modalities: ['video'],
              },
              pricing: {
                prompt: '0.000001',
                completion: '0',
                request: '0.5',
              },
            },
          ],
        }),
    });

    const [firstResult, secondResult] = await Promise.all([
      AIModelService.getModels(),
      AIModelService.getModels(),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models?output_modalities=all'
    );
    expect(firstResult).toEqual(secondResult);
    expect(firstResult).toEqual([
      {
        id: 'openai/gpt-image',
        created: 1767225600,
        modelId: 'openai/gpt-image',
        provider: 'openrouter',
        inputModality: ['text', 'image'],
        outputModality: ['text', 'video', 'embeddings'],
        inputPrice: 1,
        outputPrice: 2,
        inputPriceLabel: '$1.0 / M tokens',
        outputPriceLabel: '$2.0 / M tokens',
      },
      {
        id: 'openai/whisper-large-v3',
        created: 1777248000,
        modelId: 'openai/whisper-large-v3',
        provider: 'openrouter',
        inputModality: ['audio'],
        outputModality: ['transcription'],
        inputPrice: undefined,
        outputPrice: undefined,
        inputPriceLabel: undefined,
        outputPriceLabel: undefined,
      },
      {
        id: 'google/veo',
        created: 1777334400,
        modelId: 'google/veo',
        provider: 'openrouter',
        inputModality: ['text'],
        outputModality: ['video'],
        inputPrice: 1,
        outputPrice: undefined,
        inputPriceLabel: '$1.0 / M tokens',
        outputPriceLabel: undefined,
      },
    ]);
  });

  it('includes embedding-only models with correct pricing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: 'openai/text-embedding-3-small',
              created: 1767225600,
              architecture: {
                input_modalities: ['text'],
                output_modalities: ['embeddings'],
              },
              pricing: {
                prompt: '0.00000002',
                completion: '0',
              },
            },
            {
              id: 'google/gemini-embedding-2-preview',
              created: 1777248000,
              architecture: {
                input_modalities: ['text', 'image', 'file', 'audio', 'video'],
                output_modalities: ['embeddings'],
              },
              pricing: {
                prompt: '0.0000002',
                completion: '0',
              },
            },
          ],
        }),
    });

    const models = await AIModelService.getModels();

    // Both embedding models should be included (not filtered out)
    expect(models).toHaveLength(2);

    // Embedding-only model: input has text so inputPrice is set, output is embeddings so no outputPrice
    const smallModel = models.find((model) => model.id === 'openai/text-embedding-3-small');
    expect(smallModel).toBeDefined();
    expect(smallModel!.inputModality).toEqual(['text']);
    expect(smallModel!.outputModality).toEqual(['embeddings']);
    expect(smallModel!.inputPrice).toBeGreaterThan(0);
    expect(smallModel!.outputPrice).toBeUndefined();
    expect(smallModel!.outputPriceLabel).toBeUndefined();

    // Multimodal embedding model: input has text (among others) so inputPrice is set
    const geminiModel = models.find((model) => model.id === 'google/gemini-embedding-2-preview');
    expect(geminiModel).toBeDefined();
    expect(geminiModel!.inputModality).toContain('text');
    expect(geminiModel!.outputModality).toEqual(['embeddings']);
    expect(geminiModel!.inputPrice).toBeGreaterThan(0);
  });

  it('clears in-flight state after a failed fetch so a later call retries', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        statusText: 'Too Many Requests',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [],
          }),
      });

    // 1. First batch of concurrent calls should reject
    await expect(
      Promise.all([AIModelService.getModels(), AIModelService.getModels()])
    ).rejects.toThrow();

    // 2. Advance time by 6 seconds so the 5s negative cache expires
    const baseTime = Date.now();
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => baseTime + 6000);

    try {
      // 3. The next call should trigger a fresh fetch
      await AIModelService.getModels();

      // 4. Since the first two shared a fetch, and the third triggered a new one, the total should be 2.
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      dateSpy.mockRestore();
    }
  });

  it('serves stale cache on upstream failure and updates cache expiration to avoid pounding', async () => {
    // 1. Populate the cache with a successful fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: 'openai/gpt-image',
              created: 1767225600,
              architecture: {
                input_modalities: ['image', 'text'],
                output_modalities: ['video', 'text', 'embeddings'],
              },
              pricing: {
                prompt: '0.000001',
                completion: '0.000002',
              },
            },
          ],
        }),
    });

    const initialResult = await AIModelService.getModels();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 2. Advance time by 2 hours so cache becomes stale (TTL is 1 hour)
    const baseTime = Date.now();
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => baseTime + 2 * 60 * 60 * 1000);

    try {
      // 3. Mock fetch failure for subsequent request
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      });

      // 4. Retrieve models again - should return stale cache instead of throwing
      const staleResult = await AIModelService.getModels();
      expect(staleResult).toEqual(initialResult);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      // Restore Date.now mock
      dateSpy.mockRestore();
    }
  });

  it('serves stale cache on genuine network rejection, extends cache expiry, and does not throw', async () => {
    // 1. Populate the cache with a successful fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: 'openai/gpt-image',
              created: 1767225600,
              architecture: {
                input_modalities: ['image', 'text'],
                output_modalities: ['video', 'text', 'embeddings'],
              },
              pricing: {
                prompt: '0.000001',
                completion: '0.000002',
              },
            },
          ],
        }),
    });

    const initialResult = await AIModelService.getModels();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 2. Advance time by 2 hours so cache becomes stale (TTL is 1 hour)
    const baseTime = Date.now();
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => baseTime + 2 * 60 * 60 * 1000);

    try {
      // 3. Mock genuine network rejection for subsequent request
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      // 4. Retrieve models again - should return stale cache instead of throwing
      const staleResult = await AIModelService.getModels();
      expect(staleResult).toEqual(initialResult);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      // Restore Date.now mock
      dateSpy.mockRestore();
    }
  });
});
