import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

import { AtlasCloudProvider } from '../../src/providers/ai/atlascloud.provider';

describe('AtlasCloudProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv('ATLASCLOUD_API_KEY', 'atlas-test-key');
  });

  it('maps Atlas Cloud Text and Image models into Model Gateway catalog entries', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { model: 'qwen/qwen3.5-flash', type: 'Text', created: 1780000000 },
            { model: 'openai/gpt-image-2/text-to-image', type: 'Image' },
            { model: 'openai/gpt-image-2/edit', type: 'Image' },
            { model: 'openai/sora-2/text-to-video', type: 'Video' },
          ],
        }),
    });

    await expect(AtlasCloudProvider.getInstance().fetchModels()).resolves.toEqual([
      {
        id: 'atlascloud/qwen/qwen3.5-flash',
        created: 1780000000,
        modelId: 'atlascloud/qwen/qwen3.5-flash',
        provider: 'atlascloud',
        inputModality: ['text'],
        outputModality: ['text'],
      },
      {
        id: 'atlascloud/openai/gpt-image-2/text-to-image',
        created: undefined,
        modelId: 'atlascloud/openai/gpt-image-2/text-to-image',
        provider: 'atlascloud',
        inputModality: ['text'],
        outputModality: ['image'],
      },
      {
        id: 'atlascloud/openai/gpt-image-2/edit',
        created: undefined,
        modelId: 'atlascloud/openai/gpt-image-2/edit',
        provider: 'atlascloud',
        inputModality: ['text', 'image'],
        outputModality: ['image'],
      },
    ]);
  });

  it('submits Atlas Cloud image jobs with the unprefixed model id and polls for output', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { id: 'task-123' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              status: 'completed',
              output: [{ image_url: 'https://cdn.example.com/generated.png' }],
            },
          }),
      });

    await expect(
      AtlasCloudProvider.getInstance().generateImage({
        model: 'atlascloud/openai/gpt-image-2/text-to-image',
        prompt: 'A dashboard preview',
      })
    ).resolves.toEqual({
      images: [{ type: 'imageUrl', imageUrl: 'https://cdn.example.com/generated.png' }],
      metadata: { model: 'atlascloud/openai/gpt-image-2/text-to-image' },
    });

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://api.atlascloud.ai/api/v1/model/generateImage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer atlas-test-key' }),
        body: JSON.stringify({
          model: 'openai/gpt-image-2/text-to-image',
          prompt: 'A dashboard preview',
          enable_sync_mode: false,
          enable_base64_output: false,
        }),
      })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://api.atlascloud.ai/api/v1/model/prediction/task-123',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer atlas-test-key' },
      })
    );
  });
});
