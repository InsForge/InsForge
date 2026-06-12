import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

import { AIModelService } from '../../src/services/ai/ai-model.service';

describe('AIModelService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const firstResult = await AIModelService.getModels();
    const secondResult = await AIModelService.getModels();

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
    // Advance time past the 1-hour cache TTL so the stale cache from prior tests is bypassed
    vi.useFakeTimers();
    vi.advanceTimersByTime(61 * 60 * 1000);

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
    const smallModel = models.find((m) => m.id === 'openai/text-embedding-3-small');
    expect(smallModel).toBeDefined();
    expect(smallModel!.inputModality).toEqual(['text']);
    expect(smallModel!.outputModality).toEqual(['embeddings']);
    expect(smallModel!.inputPrice).toBeGreaterThanOrEqual(0);
    expect(smallModel!.outputPrice).toBeUndefined();
    expect(smallModel!.outputPriceLabel).toBeUndefined();

    // Multimodal embedding model: input has text (among others) so inputPrice is set
    const geminiModel = models.find((m) => m.id === 'google/gemini-embedding-2-preview');
    expect(geminiModel).toBeDefined();
    expect(geminiModel!.inputModality).toContain('text');
    expect(geminiModel!.outputModality).toEqual(['embeddings']);
    expect(geminiModel!.inputPrice).toBeGreaterThanOrEqual(0);

    vi.useRealTimers();
  });
});
