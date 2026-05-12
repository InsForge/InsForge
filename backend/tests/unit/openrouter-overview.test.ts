import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: () => false,
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { OpenRouterProvider } from '../../src/providers/ai/openrouter.provider.js';

describe('OpenRouterProvider.getOverview', () => {
  let provider: OpenRouterProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    provider = OpenRouterProvider.getInstance();
  });

  it('returns no chart buckets when the selected range has no activity', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              hash: 'hash',
              label: 'Test key',
              usage: 0,
              usage_daily: 0,
              usage_weekly: 0,
              usage_monthly: 0,
              limit: null,
              is_free_tier: false,
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

    const overview = await provider.getOverview('1w');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(overview.key.label).toBe('Test key');
    expect(overview.charts.spend).toEqual([]);
    expect(overview.charts.requests).toEqual([]);
    expect(overview.charts.tokens).toEqual([]);
    expect(overview.requests.rows).toEqual([]);
  });

  it('returns only buckets with activity inside the selected range', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              hash: 'hash',
              label: 'Test key',
              usage: 0.42,
              usage_daily: 0.1,
              usage_weekly: 0.42,
              usage_monthly: 0.42,
              limit: null,
              is_free_tier: false,
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                date: new Date().toISOString().slice(0, 10),
                model: 'openai/gpt-5.4',
                provider_name: 'OpenAI',
                usage: 0,
                requests: 0,
                prompt_tokens: 0,
                completion_tokens: 0,
              },
              {
                date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                model: 'google/gemini-2.5-pro',
                provider_name: 'Google',
                usage: 0.42,
                requests: 12,
                prompt_tokens: 1200,
                completion_tokens: 320,
              },
            ],
          }),
      });

    const overview = await provider.getOverview('1w');

    expect(overview.charts.spend).toHaveLength(2);
    expect(overview.charts.spend.map((point) => point.value)).toEqual([0, 0.42]);
    expect(overview.charts.requests.map((point) => point.value)).toEqual([0, 12]);
    expect(overview.charts.tokens.map((point) => point.value)).toEqual([0, 1520]);
  });

  it('returns empty overview when the OpenRouter key is not configured', async () => {
    const overview = await provider.getOverview('1w');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(overview.key.observabilityAvailable).toBe(false);
    expect(overview.charts.spend).toEqual([]);
    expect(overview.requests.rows).toEqual([]);
  });
});
