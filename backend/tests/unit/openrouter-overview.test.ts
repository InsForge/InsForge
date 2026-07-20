import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const environmentMock = vi.hoisted(() => ({
  isCloud: false,
}));

const modelGatewayConfigMock = vi.hoisted(() => ({
  apiKey: null as string | null,
  managementKey: null as string | null,
  getApiKey: vi.fn(),
  getManagementKey: vi.fn(),
}));

vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: () => environmentMock.isCloud,
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/services/ai/model-gateway-config.service.js', () => ({
  ModelGatewayConfigService: {
    getInstance: () => modelGatewayConfigMock,
  },
}));

import { OpenRouterProvider } from '../../src/providers/ai/openrouter.provider.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

type ProviderState = OpenRouterProvider & {
  cloudCredentials?: unknown;
  fetchPromise: Promise<string> | null;
};

function resetProviderState(provider: OpenRouterProvider) {
  const state = provider as unknown as ProviderState;
  state.cloudCredentials = undefined;
  state.fetchPromise = null;
}

describe('OpenRouterProvider.getOverview', () => {
  let provider: OpenRouterProvider;
  let fetchMock: ReturnType<typeof vi.fn>;
  const fixedNow = new Date('2026-05-12T12:34:56Z');
  const completedDayLabels = () => {
    const dayCount = 30;
    const end = new Date(fixedNow);
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - (dayCount - 1));
    return Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(start.getTime() + index * 24 * 60 * 60 * 1000);
      return date.toISOString().slice(0, 10);
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    environmentMock.isCloud = false;
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    modelGatewayConfigMock.apiKey = null;
    modelGatewayConfigMock.managementKey = null;
    modelGatewayConfigMock.getApiKey.mockImplementation(() =>
      Promise.resolve(
        modelGatewayConfigMock.apiKey
          ? { value: modelGatewayConfigMock.apiKey, source: 'dashboard' as const }
          : null
      )
    );
    modelGatewayConfigMock.getManagementKey.mockImplementation(() =>
      Promise.resolve(
        modelGatewayConfigMock.managementKey
          ? { value: modelGatewayConfigMock.managementKey, source: 'dashboard' as const }
          : null
      )
    );
    provider = OpenRouterProvider.getInstance();
    resetProviderState(provider);
  });

  afterEach(() => {
    resetProviderState(provider);
    vi.useRealTimers();
  });

  it('returns the last 30 completed UTC day buckets when there is no activity', async () => {
    modelGatewayConfigMock.apiKey = 'sk-or-test';
    modelGatewayConfigMock.managementKey = 'sk-or-management-test';
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

    const overview = await provider.getOverview();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.any(URL),
      expect.objectContaining({
        headers: { Authorization: 'Bearer sk-or-management-test' },
      })
    );
    expect(overview.key.label).toBe('Test key');
    expect(overview.charts.spend).toHaveLength(30);
    expect(overview.charts.spend.map((point) => point.label)).toEqual(completedDayLabels());
    expect(overview.charts.spend.map((point) => point.value)).toEqual(Array(30).fill(0));
    expect(overview.charts.requests.map((point) => point.value)).toEqual(Array(30).fill(0));
    expect(overview.charts.tokens.map((point) => point.value)).toEqual(Array(30).fill(0));
    expect(overview.modelUsage).toEqual([]);
  });

  it('returns full completed-day buckets and ignores today and older activity', async () => {
    modelGatewayConfigMock.apiKey = 'sk-or-test';
    modelGatewayConfigMock.managementKey = 'sk-or-management-test';
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
                usage: 0.11,
                requests: 4,
                prompt_tokens: 400,
                completion_tokens: 44,
              },
              {
                date: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                model: 'anthropic/claude-sonnet-4.6',
                provider_name: 'Anthropic',
                usage: 0.99,
                requests: 99,
                prompt_tokens: 100,
                completion_tokens: 100,
              },
              {
                byok_usage_inference: 0.03,
                date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                model: 'google/gemini-2.5-pro',
                model_permaslug: 'google/gemini-2.5-pro-2026-01-01',
                provider_name: 'Google',
                usage: 0.42,
                requests: 12,
                prompt_tokens: 1200,
                completion_tokens: 320,
              },
              {
                byok_usage_inference: 0.02,
                date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
                model: 'openai/gpt-5.4',
                provider_name: 'OpenAI',
                usage: 0.2,
                requests: 2,
                prompt_tokens: 20,
                completion_tokens: 10,
              },
            ],
          }),
      });

    const overview = await provider.getOverview();
    const spendByLabel = new Map(
      overview.charts.spend.map((point) => [point.label, point.value] as const)
    );
    const requestsByLabel = new Map(
      overview.charts.requests.map((point) => [point.label, point.value] as const)
    );
    const tokensByLabel = new Map(
      overview.charts.tokens.map((point) => [point.label, point.value] as const)
    );

    expect(overview.charts.spend).toHaveLength(30);
    expect(overview.charts.spend.map((point) => point.label)).toEqual(completedDayLabels());
    expect(spendByLabel.get('2026-05-10')).toBe(0.42);
    expect(requestsByLabel.get('2026-05-10')).toBe(12);
    expect(tokensByLabel.get('2026-05-10')).toBe(1520);
    expect(spendByLabel.get('2026-05-11')).toBe(0.2);
    expect(requestsByLabel.get('2026-05-11')).toBe(2);
    expect(tokensByLabel.get('2026-05-11')).toBe(30);
    expect(spendByLabel.has('2026-05-12')).toBe(false);
    expect(overview.modelUsage).toEqual([
      {
        model: 'google/gemini-2.5-pro',
        providers: ['Google'],
        requests: 12,
        promptTokens: 1200,
        completionTokens: 320,
        reasoningTokens: 0,
        totalTokens: 1520,
        spend: 0.42,
        byokSpend: 0.03,
      },
      {
        model: 'openai/gpt-5.4',
        providers: ['OpenAI'],
        requests: 2,
        promptTokens: 20,
        completionTokens: 10,
        reasoningTokens: 0,
        totalTokens: 30,
        spend: 0.2,
        byokSpend: 0.02,
      },
    ]);
  });

  it('sorts daily buckets in chronological order', async () => {
    modelGatewayConfigMock.apiKey = 'sk-or-test';
    modelGatewayConfigMock.managementKey = 'sk-or-management-test';
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              hash: 'hash',
              label: 'Test key',
              usage: 0.45,
              usage_daily: 0,
              usage_weekly: 0.45,
              usage_monthly: 0.45,
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
                date: '2026-05-10',
                model: 'openai/gpt-5.4',
                provider_name: 'OpenAI',
                usage: 0.2,
                requests: 2,
                prompt_tokens: 20,
                completion_tokens: 10,
              },
              {
                date: '2026-05-09',
                model: 'google/gemini-2.5-pro',
                provider_name: 'Google',
                usage: 0.25,
                requests: 3,
                prompt_tokens: 30,
                completion_tokens: 15,
              },
            ],
          }),
      });

    const overview = await provider.getOverview();

    expect(overview.charts.spend.map((point) => point.label)).toEqual(completedDayLabels());
    expect(overview.charts.spend[27]).toEqual({ label: '2026-05-09', value: 0.25 });
    expect(overview.charts.spend[28]).toEqual({ label: '2026-05-10', value: 0.2 });
    expect(overview.charts.requests[27]).toEqual({ label: '2026-05-09', value: 3 });
    expect(overview.charts.requests[28]).toEqual({ label: '2026-05-10', value: 2 });
    expect(overview.charts.tokens[27]).toEqual({ label: '2026-05-09', value: 45 });
    expect(overview.charts.tokens[28]).toEqual({ label: '2026-05-10', value: 30 });
  });

  it('returns empty overview when the OpenRouter key is not configured', async () => {
    const overview = await provider.getOverview();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(overview.key.observabilityAvailable).toBe(false);
    expect(overview.charts.spend).toEqual([]);
  });

  it('returns key usage without activity when the management key is not configured', async () => {
    modelGatewayConfigMock.apiKey = 'sk-or-test';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            hash: 'hash',
            label: 'Test key',
            usage: 1,
            usage_daily: 0.1,
            usage_weekly: 0.5,
            usage_monthly: 1,
            limit: null,
            is_free_tier: false,
          },
        }),
    });

    const overview = await provider.getOverview();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(overview.key.observabilityAvailable).toBe(false);
    expect(overview.key.observabilityError).toContain('management key');
    expect(overview.modelUsage).toEqual([]);
  });

  it.each([
    { mode: 'self-hosting', isCloud: false, upstreamStatus: 401 },
    { mode: 'cloud-hosting', isCloud: true, upstreamStatus: 403 },
  ])(
    'returns a business error instead of $upstreamStatus for an invalid $mode key',
    async ({ isCloud, upstreamStatus }) => {
      environmentMock.isCloud = isCloud;

      if (isCloud) {
        vi.stubEnv('PROJECT_ID', 'project_123');
        vi.stubEnv('JWT_SECRET', 'test-secret-long-enough-for-signing-32chars');
        vi.stubEnv('CLOUD_API_HOST', 'https://cloud.example');
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              openrouter: { api_key: 'sk-or-cloud-invalid', limit_remaining: 10 },
            }),
        });
      } else {
        modelGatewayConfigMock.apiKey = 'sk-or-self-hosted-invalid';
      }

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: upstreamStatus,
      });

      await expect(provider.getOverview()).rejects.toMatchObject({
        statusCode: 400,
        code: ERROR_CODES.AI_INVALID_API_KEY,
        message: 'Invalid OpenRouter API Key',
      });
    }
  );
});
