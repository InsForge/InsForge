import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { LocalAnalyticsProvider } from '../../src/providers/analytics/local.provider.js';
import type { StoredPosthogConnection } from '../../src/services/analytics/posthog-config.service.js';

vi.mock('../../src/utils/logger.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// vi.hoisted: the provider is imported statically above, so the mock factory
// runs before a plain top-level const would be initialised.
const { axiosIsAxiosError } = vi.hoisted(() => ({
  axiosIsAxiosError: vi.fn(
    (err: unknown) => (err as { __isAxiosError?: boolean })?.__isAxiosError === true
  ),
}));
vi.mock('axios', () => ({
  default: { isAxiosError: axiosIsAxiosError, patch: vi.fn(), get: vi.fn(), post: vi.fn() },
  isAxiosError: axiosIsAxiosError,
}));

const CONNECTION: StoredPosthogConnection = {
  personalApiKey: 'phx_key',
  host: 'https://us.posthog.com',
  posthogProjectId: '4242',
  apiKey: 'phc_public',
  organizationName: 'Acme',
  projectName: 'Web',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function makeAxiosError(status: number) {
  const err = new Error(`Request failed with status code ${status}`) as Error & {
    __isAxiosError: true;
    response: { status: number; data: unknown };
  };
  err.__isAxiosError = true;
  err.response = { status, data: { detail: 'nope' } };
  return err;
}

function makeApi() {
  return {
    listDashboards: vi.fn(),
    listEvents: vi.fn(),
    listRecordings: vi.fn(),
    runHogQLQuery: vi.fn(),
    runQuery: vi.fn(),
    refreshRecordingShare: vi.fn(),
  };
}

function makeProvider(conn: StoredPosthogConnection | null = CONNECTION) {
  const api = makeApi();
  const config = {
    getConnection: vi.fn(async () => conn),
    deleteConnection: vi.fn(async () => undefined),
  };
  const provider = new LocalAnalyticsProvider(config as never, api as never);
  return { provider, api, config };
}

describe('LocalAnalyticsProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('connection gating', () => {
    it('returns null connection when nothing is stored', async () => {
      const { provider } = makeProvider(null);
      await expect(provider.getConnection()).resolves.toBeNull();
    });

    it('answers 404 ANALYTICS_NOT_CONNECTED on panels when not connected', async () => {
      const { provider } = makeProvider(null);
      await expect(provider.getWebOverview('7d')).rejects.toMatchObject({
        statusCode: 404,
        code: ERROR_CODES.ANALYTICS_NOT_CONNECTED,
      });
    });

    it('derives region from host and exposes the public phc_ key', async () => {
      const { provider } = makeProvider({ ...CONNECTION, host: 'https://eu.posthog.com' });
      const conn = await provider.getConnection();
      expect(conn).toMatchObject({
        region: 'EU',
        host: 'https://eu.posthog.com',
        apiKey: 'phc_public',
        status: 'active',
        posthogProjectId: '4242',
      });
    });
  });

  describe('upstream error mapping', () => {
    // A PostHog 401 must not reach the dashboard as a 401 — that reads as an
    // InsForge session failure and bounces the user to login, when the real fix
    // is reconnecting PostHog.
    it('remaps PostHog 401 to 502 with a reconnect hint', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockRejectedValue(makeAxiosError(401));

      await expect(provider.getWebOverview('7d')).rejects.toMatchObject({
        statusCode: 502,
        code: ERROR_CODES.UPSTREAM_FAILURE,
      });
      await expect(provider.getWebOverview('7d')).rejects.toThrow(/reconnect PostHog/i);
    });

    // A missing scope must not read as a revoked key — PostHog's detail names
    // the one checkbox to fix.
    it('surfaces the missing-scope detail from a PostHog 403', async () => {
      const { provider, api } = makeProvider();
      const err = makeAxiosError(403);
      err.response.data = { detail: "API key missing required scope 'session_recording:read'" };
      api.listRecordings.mockRejectedValue(err);

      await expect(provider.getRecordings()).rejects.toThrow(/session_recording:read/);
      await expect(provider.getRecordings()).rejects.toThrow(/scopes/);
    });

    it('passes through non-auth upstream status codes', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockRejectedValue(makeAxiosError(429));

      await expect(provider.getRetention()).rejects.toMatchObject({ statusCode: 429 });
    });

    it('does not leak PostHog response bodies to the client', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockRejectedValue(makeAxiosError(500));

      await expect(provider.getRetention()).rejects.toThrow(/PostHog request failed\.$/);
    });
  });

  describe('web-overview', () => {
    it('normalises keys and null-guards the numbers', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({
        results: [
          { key: 'visitors', value: 10, previous: 5, changeFromPreviousPct: 100 },
          { key: 'bounce rate', value: null, previous: null, changeFromPreviousPct: null },
          { key: 'views', value: 'nope' },
        ],
      });

      const out = await provider.getWebOverview('7d');
      expect(out.items).toEqual([
        { key: 'visitors', value: 10, previous: 5, changeFromPreviousPct: 100 },
        { key: 'bounce_rate', value: null, previous: null, changeFromPreviousPct: null },
        { key: 'views', value: null, previous: null, changeFromPreviousPct: null },
      ]);
    });

    it('maps each timeframe to the right date_from', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({ results: [] });

      for (const [tf, expected] of [
        ['24h', '-24h'],
        ['7d', '-7d'],
        ['30d', '-30d'],
        ['3m', '-90d'],
      ] as const) {
        await provider.getWebOverview(tf);
        const body = api.runQuery.mock.lastCall?.[0].queryBody as {
          query: { dateRange: { date_from: string } };
        };
        expect(body.query.dateRange.date_from).toBe(expected);
      }
    });

    it('falls back to 7d for an unknown timeframe', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({ results: [] });

      await provider.getWebOverview('nonsense');
      const body = api.runQuery.mock.lastCall?.[0].queryBody as {
        query: { dateRange: { date_from: string } };
      };
      expect(body.query.dateRange.date_from).toBe('-7d');
    });
  });

  describe('web-stats', () => {
    // PostHog returns tuples: [breakdown, [visitors, prev], [views, prev], fill, x-sell]
    it('flattens PostHog row tuples into the schema shape', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({
        results: [
          ['/home', [120, 100], [300, 250], 1, null],
          [null, [5, 4], [7, 6], 0.5, null],
        ],
      });

      const out = await provider.getWebStats('Page', '7d');
      expect(out.rows).toEqual([
        { breakdownValue: '/home', visitors: 120, views: 300, uiFillFraction: 1 },
        { breakdownValue: null, visitors: 5, views: 7, uiFillFraction: 0.5 },
      ]);
    });

    it('survives malformed tuples rather than throwing', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({ results: [['/x', 'bad', undefined, 'bad']] });

      const out = await provider.getWebStats('Page', '7d');
      expect(out.rows).toEqual([
        { breakdownValue: '/x', visitors: 0, views: 0, uiFillFraction: 0 },
      ]);
    });

    it('passes the breakdown through to PostHog', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({ results: [] });

      await provider.getWebStats('Country', '30d');
      const body = api.runQuery.mock.lastCall?.[0].queryBody as {
        query: { kind: string; breakdownBy: string };
      };
      expect(body.query).toMatchObject({ kind: 'WebStatsTableQuery', breakdownBy: 'Country' });
    });
  });

  describe('trends', () => {
    it('uses dau math for visitors and total for views', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({ results: [{ data: [], days: [] }] });

      await provider.getTrends('visitors', '7d');
      let body = api.runQuery.mock.lastCall?.[0].queryBody as {
        query: { series: { math: string }[] };
      };
      expect(body.query.series[0].math).toBe('dau');

      await provider.getTrends('views', '7d');
      body = api.runQuery.mock.lastCall?.[0].queryBody as {
        query: { series: { math: string }[] };
      };
      expect(body.query.series[0].math).toBe('total');
    });

    it('zips days with data', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({
        results: [{ data: [1, 2, 3], days: ['2026-01-01', '2026-01-02', '2026-01-03'] }],
      });

      const out = await provider.getTrends('views', '7d');
      expect(out.series).toEqual([
        { date: '2026-01-01', count: 1 },
        { date: '2026-01-02', count: 2 },
        { date: '2026-01-03', count: 3 },
      ]);
    });

    it('falls back to labels when days is absent', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({ results: [{ data: [7], labels: ['Mon'] }] });

      const out = await provider.getTrends('views', '7d');
      expect(out.series).toEqual([{ date: 'Mon', count: 7 }]);
    });

    // Bounce rate is session-level: averaging $is_bounce over events weights each
    // session by its pageview count and skews the result.
    it('computes bounce_rate with a session-level HogQL query', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({ results: [['2026-01-01', 0.42]] });

      const out = await provider.getTrends('bounce_rate', '7d');
      const body = api.runQuery.mock.lastCall?.[0].queryBody as {
        query: { kind: string; query: string };
      };
      expect(body.query.kind).toBe('HogQLQuery');
      expect(body.query.query).toContain('GROUP BY session_id');
      expect(body.query.query).toContain('countIf(is_bounce) / count()');
      expect(out.series).toEqual([{ date: '2026-01-01', count: 0.42 }]);
    });

    it('buckets bounce_rate by the timeframe interval', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({ results: [] });

      await provider.getTrends('bounce_rate', '24h');
      let sql = (api.runQuery.mock.lastCall?.[0].queryBody as { query: { query: string } }).query
        .query;
      expect(sql).toContain('toStartOfHour');
      expect(sql).toContain('INTERVAL 24 HOUR');

      await provider.getTrends('bounce_rate', '3m');
      sql = (api.runQuery.mock.lastCall?.[0].queryBody as { query: { query: string } }).query.query;
      expect(sql).toContain('toStartOfWeek');
      expect(sql).toContain('INTERVAL 90 DAY');
    });

    // The window and the grouping bucket are separate concerns: 3m groups by
    // week but must still read 90 days, not 90 weeks.
    it.each([
      ['24h', 'INTERVAL 24 HOUR'],
      ['7d', 'INTERVAL 7 DAY'],
      ['30d', 'INTERVAL 30 DAY'],
      ['3m', 'INTERVAL 90 DAY'],
    ])('reads the same window as the other panels for %s', async (tf, expected) => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({ results: [] });

      await provider.getTrends('bounce_rate', tf);
      const sql = (api.runQuery.mock.lastCall?.[0].queryBody as { query: { query: string } }).query
        .query;
      expect(sql).toContain(expected);
      expect(sql).not.toMatch(/INTERVAL \d+ WEEK/);
    });
  });

  describe('retention', () => {
    it('always requests 8 weekly intervals regardless of page timeframe', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({ results: [] });

      await provider.getRetention();
      const body = api.runQuery.mock.lastCall?.[0].queryBody as {
        query: { retentionFilter: { period: string; totalIntervals: number } };
      };
      expect(body.query.retentionFilter).toMatchObject({ period: 'Week', totalIntervals: 8 });
    });

    it('maps rows and preserves null counts', async () => {
      const { provider, api } = makeProvider();
      api.runQuery.mockResolvedValue({
        results: [
          { date: '2026-01-01', label: 'Week 0', values: [{ count: 10 }, { count: null }] },
        ],
      });

      const out = await provider.getRetention();
      expect(out.rows).toEqual([
        { date: '2026-01-01', label: 'Week 0', values: [{ count: 10 }, { count: null }] },
      ]);
    });
  });

  describe('recordings', () => {
    it('maps PostHog recording fields, falling back to recording_duration', async () => {
      const { provider, api } = makeProvider();
      api.listRecordings.mockResolvedValue({
        results: [
          {
            id: 'rec1',
            distinct_id: 'user-1',
            recording_duration: 90,
            start_time: 'a',
            end_time: 'b',
            start_url: null,
            click_count: 3,
            console_error_count: 1,
          },
        ],
      });

      const out = await provider.getRecordings(5);
      expect(out.items[0]).toEqual({
        id: 'rec1',
        distinctId: 'user-1',
        durationSeconds: 90,
        startTime: 'a',
        endTime: 'b',
        startUrl: null,
        clickCount: 3,
        consoleErrorCount: 1,
      });
      expect(api.listRecordings.mock.lastCall?.[0]).toMatchObject({ limit: 5 });
    });

    // An EU recording is not readable through a US host, so the embed URL has
    // to follow the connection's region rather than a fixed app.posthog.com.
    it.each([
      ['https://us.posthog.com', 'https://us.posthog.com/embedded/tok123'],
      ['https://eu.posthog.com', 'https://eu.posthog.com/embedded/tok123'],
    ])('builds the embed URL on the connection host (%s)', async (host, expected) => {
      const { provider, api } = makeProvider({ ...CONNECTION, host });
      api.refreshRecordingShare.mockResolvedValue({ access_token: 'tok123' });

      const out = await provider.createRecordingShare('rec1');
      expect(out.embedUrl).toBe(expected);
    });

    it('fails clearly when PostHog returns no share token', async () => {
      const { provider, api } = makeProvider();
      api.refreshRecordingShare.mockResolvedValue({});

      await expect(provider.createRecordingShare('rec1')).rejects.toMatchObject({
        statusCode: 502,
      });
    });
  });

  describe('summary', () => {
    it('reads the four HogQL aggregates into the summary shape', async () => {
      const { provider, api } = makeProvider();
      api.runHogQLQuery
        .mockResolvedValueOnce({ results: [[11]] })
        .mockResolvedValueOnce({ results: [[22]] })
        .mockResolvedValueOnce({ results: [[33]] })
        .mockResolvedValueOnce({ results: [['$pageview', 44]] });

      const out = await provider.getSummary();
      expect(out).toEqual({
        todayEvents: 11,
        dau24h: 22,
        totalEvents7d: 33,
        topEvents: [{ event: '$pageview', count: 44 }],
      });
    });
  });

  describe('disconnect', () => {
    it('clears the stored credential', async () => {
      const { provider, config } = makeProvider();
      await provider.disconnect();
      expect(config.deleteConnection).toHaveBeenCalledOnce();
    });
  });
});
