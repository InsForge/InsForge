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

  it('returns seven daily buckets for the one week range', async () => {
    const overview = await provider.getOverview('1w');

    expect(overview.charts.spend).toHaveLength(7);
    expect(overview.charts.requests).toHaveLength(7);
    expect(overview.charts.tokens).toHaveLength(7);
  });

  it('returns hard-coded mock overview data without upstream calls', async () => {
    const overview = await provider.getOverview('1w');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(overview.key.label).toBe('Local mock key');
    expect(overview.key.observabilityAvailable).toBe(true);
    expect(overview.charts.spend).toHaveLength(7);
    expect(overview.charts.spend.some((point) => point.value > 0)).toBe(true);
    expect(overview.requests.rows.length).toBeGreaterThan(0);
  });
});
