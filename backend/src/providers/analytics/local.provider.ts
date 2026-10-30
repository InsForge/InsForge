import axios from 'axios';
import {
  ERROR_CODES,
  type PosthogConnection,
  type PosthogDashboardsResponse,
  type PosthogEventsResponse,
  type PosthogRecordingsResponse,
  type PosthogRetentionResponse,
  type PosthogShareTokenResponse,
  type PosthogSummary,
  type PosthogTimeframe,
  type PosthogTrendsResponse,
  type PosthogWebOverviewResponse,
  type PosthogWebStatsResponse,
  type PosthogWebStatsRow,
} from '@insforge/shared-schemas';
import { AppError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';
import {
  PostHogConfigService,
  type StoredPosthogConnection,
} from '@/services/analytics/posthog-config.service.js';
import { PostHogApiService } from '@/services/analytics/posthog-api.service.js';
import type { AnalyticsProvider } from './base.provider.js';

// timeframe → PostHog dateRange.date_from + TrendsQuery.interval. Mirrors
// cloud-backend's TIMEFRAME_MAP so both paths produce identical panels.
const TIMEFRAME_MAP: Record<
  PosthogTimeframe,
  { dateFrom: string; trendsInterval: 'hour' | 'day' | 'week' }
> = {
  '24h': { dateFrom: '-24h', trendsInterval: 'hour' },
  '7d': { dateFrom: '-7d', trendsInterval: 'day' },
  '30d': { dateFrom: '-30d', trendsInterval: 'day' },
  '3m': { dateFrom: '-90d', trendsInterval: 'week' },
};

// HogQL helpers for bounce_rate trends. PostHog's TrendsQuery has no bounce_rate
// math primitive, so it is composed against `session.$is_bounce` using the same
// timeframe → interval bucketing as the other metrics.
const HOGQL_BUCKET_BY_INTERVAL: Record<
  'hour' | 'day' | 'week',
  {
    toStartOf: 'toStartOfHour' | 'toStartOfDay' | 'toStartOfWeek';
    intervalUnit: 'HOUR' | 'DAY' | 'WEEK';
  }
> = {
  hour: { toStartOf: 'toStartOfHour', intervalUnit: 'HOUR' },
  day: { toStartOf: 'toStartOfDay', intervalUnit: 'DAY' },
  week: { toStartOf: 'toStartOfWeek', intervalUnit: 'WEEK' },
};

// Independent of the bucket above: reusing `bucket.intervalUnit` made 3m mean
// `INTERVAL 90 WEEK` (~630 days) while every other panel read -90d.
// cloud-backend's PosthogController has the same defect.
const HOGQL_WINDOW_BY_TIMEFRAME: Record<PosthogTimeframe, { span: number; unit: 'HOUR' | 'DAY' }> =
  {
    '24h': { span: 24, unit: 'HOUR' },
    '7d': { span: 7, unit: 'DAY' },
    '30d': { span: 30, unit: 'DAY' },
    '3m': { span: 90, unit: 'DAY' },
  };

function timeframeOf(raw: string): PosthogTimeframe {
  return raw === '24h' || raw === '7d' || raw === '30d' || raw === '3m' ? raw : '7d';
}

/**
 * Self-hosted analytics: talks to PostHog directly using the personal API key
 * stored by PostHogConfigService. The cloud path proxies the equivalent calls
 * to cloud-backend, which holds an OAuth connection instead.
 */
export class LocalAnalyticsProvider implements AnalyticsProvider {
  private static instance: LocalAnalyticsProvider;

  constructor(
    private readonly config: PostHogConfigService = PostHogConfigService.getInstance(),
    private readonly api: PostHogApiService = PostHogApiService.getInstance()
  ) {}

  static getInstance(): LocalAnalyticsProvider {
    if (!LocalAnalyticsProvider.instance) {
      LocalAnalyticsProvider.instance = new LocalAnalyticsProvider();
    }
    return LocalAnalyticsProvider.instance;
  }

  // Panel endpoints need a connection to do anything; 404 is what the dashboard's
  // RequireAnalyticsConnection gate reads to show the connect panel.
  private async requireConnection(): Promise<StoredPosthogConnection> {
    const conn = await this.config.getConnection();
    if (!conn) {
      throw new AppError('PostHog not connected', 404, ERROR_CODES.ANALYTICS_NOT_CONNECTED);
    }
    return conn;
  }

  private scope(conn: StoredPosthogConnection) {
    return {
      personalApiKey: conn.personalApiKey,
      host: conn.host,
      posthogProjectId: conn.posthogProjectId,
    };
  }

  // PostHog 401/403 becomes 502: a 401 reaching the dashboard reads as an
  // expired InsForge session and bounces the user to login, when the fix is to
  // reconnect PostHog. Detail is logged, not returned.
  private upstreamError(err: unknown, label: string): AppError {
    let status = 502;
    let detail = 'unknown error';
    let upstreamStatus: number | undefined;

    if (axios.isAxiosError(err)) {
      upstreamStatus = err.response?.status;
      if (upstreamStatus && upstreamStatus !== 401 && upstreamStatus !== 403) {
        status = upstreamStatus;
      }
      const body = err.response?.data;
      if (typeof body === 'string') {
        detail = body;
      } else if (body && typeof body === 'object') {
        detail = JSON.stringify(body);
      } else if (err.message) {
        detail = err.message;
      }
    } else if (err instanceof Error) {
      detail = err.message;
    }

    logger.error(`PostHog ${label} request failed`, { err: detail, status, upstreamStatus });

    // On auth failures PostHog's body names the exact problem (e.g. "API key
    // missing required scope 'session_recording:read'") — surface it, or the
    // user is told to reconnect when the fix is one scope checkbox.
    const authDetail =
      typeof (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail ===
      'string'
        ? ((err as { response: { data: { detail: string } } }).response.data.detail as string)
        : null;
    const message =
      upstreamStatus === 401 || upstreamStatus === 403
        ? authDetail
          ? `PostHog rejected the request: ${authDetail}. Update the key's scopes, or reconnect PostHog.`
          : 'PostHog rejected the request. The stored personal API key may have been revoked — reconnect PostHog.'
        : 'PostHog request failed.';
    return new AppError(message, status, ERROR_CODES.UPSTREAM_FAILURE);
  }

  async getConnection(): Promise<PosthogConnection | null> {
    const conn = await this.config.getConnection();
    if (!conn) {
      return null;
    }
    return {
      posthogProjectId: conn.posthogProjectId,
      organizationName: conn.organizationName,
      projectName: conn.projectName,
      // Region is derived from the host rather than stored: the two are always
      // consistent that way, and host is the value every outbound call uses.
      region: conn.host.includes('eu.posthog.com') ? 'EU' : 'US',
      host: conn.host,
      // phc_ — public, write-only ingestion key. Deliberately returned: the
      // dashboard and the CLI both need it to wire the SDK into an app.
      apiKey: conn.apiKey,
      status: 'active',
      createdAt: conn.createdAt,
    };
  }

  async disconnect(): Promise<void> {
    await this.config.deleteConnection();
  }

  async getDashboards(): Promise<PosthogDashboardsResponse> {
    const conn = await this.requireConnection();
    try {
      const resp = await this.api.listDashboards(this.scope(conn));
      return {
        dashboards: (resp.results ?? []).map((d) => ({
          id: d.id,
          name: d.name,
          description: d.description,
          pinned: d.pinned,
          lastModifiedAt: d.last_modified_at,
          url: `${conn.host}/project/${conn.posthogProjectId}/dashboard/${d.id}`,
        })),
        count: resp.count,
      };
    } catch (err) {
      throw this.upstreamError(err, 'dashboards');
    }
  }

  async getSummary(): Promise<PosthogSummary> {
    const conn = await this.requireConnection();
    const scope = this.scope(conn);
    try {
      const [today, dau, total7d, top] = await Promise.all([
        this.api.runHogQLQuery({
          ...scope,
          query: 'SELECT count() FROM events WHERE timestamp > today()',
        }),
        this.api.runHogQLQuery({
          ...scope,
          query:
            'SELECT count(distinct distinct_id) FROM events WHERE timestamp > now() - INTERVAL 1 DAY',
        }),
        this.api.runHogQLQuery({
          ...scope,
          query: 'SELECT count() FROM events WHERE timestamp > now() - INTERVAL 7 DAY',
        }),
        this.api.runHogQLQuery({
          ...scope,
          query:
            'SELECT event, count() as c FROM events WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY event ORDER BY c DESC LIMIT 10',
        }),
      ]);
      return {
        todayEvents: Number(today.results?.[0]?.[0] ?? 0),
        dau24h: Number(dau.results?.[0]?.[0] ?? 0),
        totalEvents7d: Number(total7d.results?.[0]?.[0] ?? 0),
        topEvents: (top.results ?? []).map((row) => ({
          event: String(row[0] ?? ''),
          count: Number(row[1] ?? 0),
        })),
      };
    } catch (err) {
      throw this.upstreamError(err, 'summary');
    }
  }

  async getRecentEvents(limit = 10): Promise<PosthogEventsResponse> {
    const conn = await this.requireConnection();
    try {
      const data = await this.api.listEvents({ ...this.scope(conn), limit });
      return {
        events: (data.results ?? []).map((e) => ({
          id: e.id,
          event: e.event,
          distinctId: e.distinct_id,
          timestamp: e.timestamp,
        })),
        next: data.next ?? null,
      };
    } catch (err) {
      throw this.upstreamError(err, 'events');
    }
  }

  async getWebOverview(timeframe: string): Promise<PosthogWebOverviewResponse> {
    const conn = await this.requireConnection();
    const tf = timeframeOf(timeframe);
    try {
      const raw = await this.api.runQuery<{
        results?: Array<{
          key?: string;
          value?: number | null;
          previous?: number | null;
          changeFromPreviousPct?: number | null;
        }>;
      }>({
        ...this.scope(conn),
        queryBody: {
          query: {
            kind: 'WebOverviewQuery',
            dateRange: { date_from: TIMEFRAME_MAP[tf].dateFrom },
            properties: [],
          },
        },
      });
      return {
        items: (raw.results ?? []).map((r) => ({
          key: String(r.key ?? '').replace(/ /g, '_'),
          value: typeof r.value === 'number' ? r.value : null,
          previous: typeof r.previous === 'number' ? r.previous : null,
          changeFromPreviousPct:
            typeof r.changeFromPreviousPct === 'number' ? r.changeFromPreviousPct : null,
        })),
      };
    } catch (err) {
      throw this.upstreamError(err, 'web-overview');
    }
  }

  async getWebStats(breakdown: string, timeframe: string): Promise<PosthogWebStatsResponse> {
    const conn = await this.requireConnection();
    const tf = timeframeOf(timeframe);
    try {
      const raw = await this.api.runQuery<{ results?: unknown[][] }>({
        ...this.scope(conn),
        queryBody: {
          query: {
            kind: 'WebStatsTableQuery',
            breakdownBy: breakdown,
            dateRange: { date_from: TIMEFRAME_MAP[tf].dateFrom },
            properties: [],
          },
        },
      });
      // WebStatsTableQuery returns each row as a tuple:
      //   [breakdown_value, [visitors, prev], [views, prev], ui_fill_fraction, cross_sell]
      // Flatten to the object shape the shared schema and dashboard expect.
      const rows: PosthogWebStatsRow[] = (raw.results ?? []).map((row) => {
        const breakdownValue = row[0];
        const visitorsTuple = Array.isArray(row[1]) ? (row[1] as unknown[]) : [0];
        const viewsTuple = Array.isArray(row[2]) ? (row[2] as unknown[]) : [0];
        return {
          breakdownValue:
            breakdownValue === null || breakdownValue === undefined ? null : String(breakdownValue),
          visitors: Number(visitorsTuple[0] ?? 0),
          views: Number(viewsTuple[0] ?? 0),
          uiFillFraction: typeof row[3] === 'number' ? row[3] : 0,
        };
      });
      return { rows };
    } catch (err) {
      throw this.upstreamError(err, 'web-stats');
    }
  }

  async getTrends(metric: string, timeframe: string): Promise<PosthogTrendsResponse> {
    const conn = await this.requireConnection();
    const tf = timeframeOf(timeframe);
    const interval = TIMEFRAME_MAP[tf].trendsInterval;

    if (metric === 'bounce_rate') {
      return this.getBounceRateTrend(conn, tf, interval);
    }

    // visitors → math: 'dau', views → math: 'total'
    const math = metric === 'visitors' ? 'dau' : 'total';
    try {
      const raw = await this.api.runQuery<{
        results?: Array<{ data?: number[]; labels?: string[]; days?: string[] }>;
      }>({
        ...this.scope(conn),
        queryBody: {
          query: {
            kind: 'TrendsQuery',
            series: [{ kind: 'EventsNode', event: '$pageview', math }],
            interval,
            dateRange: { date_from: TIMEFRAME_MAP[tf].dateFrom },
          },
        },
      });
      const first = raw.results?.[0];
      const data = Array.isArray(first?.data) ? first.data : [];
      const dates = Array.isArray(first?.days)
        ? first.days
        : Array.isArray(first?.labels)
          ? first.labels
          : [];
      return {
        series: data.map((count, i) => ({
          date: String(dates[i] ?? i),
          count: Number(count ?? 0),
        })),
      };
    } catch (err) {
      throw this.upstreamError(err, 'trends');
    }
  }

  /**
   * Bounce rate must be computed at the SESSION level, not the event level.
   * Averaging `session.$is_bounce` across `events` weights each session by its
   * pageview count — a 5-pageview unbounced session contributes 5 rows while a
   * bounced one contributes 1 — which pulls the average away from the true
   * session bounce rate. Inner query: one row per session in the window with
   * its bounce flag and the bucket key from its earliest pageview. Outer query:
   * bounced_sessions / total_sessions per bucket.
   *
   * toStartOfDay/Hour/Week use the team's configured timezone via HogQL, so the
   * buckets line up with the built-in WebOverviewQuery / TrendsQuery KPIs.
   */
  private async getBounceRateTrend(
    conn: StoredPosthogConnection,
    tf: PosthogTimeframe,
    interval: 'hour' | 'day' | 'week'
  ): Promise<PosthogTrendsResponse> {
    const bucket = HOGQL_BUCKET_BY_INTERVAL[interval];
    const window = HOGQL_WINDOW_BY_TIMEFRAME[tf];
    const sql =
      `SELECT\n` +
      `  ${bucket.toStartOf}(min_ts) AS day,\n` +
      `  countIf(is_bounce) / count() AS bounce_rate\n` +
      `FROM (\n` +
      `  SELECT\n` +
      `    session.session_id AS session_id,\n` +
      `    min(timestamp) AS min_ts,\n` +
      `    any(session.$is_bounce) AS is_bounce\n` +
      `  FROM events\n` +
      `  WHERE event = '$pageview'\n` +
      `    AND timestamp > now() - INTERVAL ${window.span} ${window.unit}\n` +
      `    AND session.$is_bounce IS NOT NULL\n` +
      `    AND session.session_id IS NOT NULL\n` +
      `  GROUP BY session_id\n` +
      `)\n` +
      `GROUP BY day\n` +
      `ORDER BY day`;
    try {
      const raw = await this.api.runQuery<{
        results?: Array<[string | number | null, number | null]>;
      }>({
        ...this.scope(conn),
        queryBody: { query: { kind: 'HogQLQuery', query: sql } },
      });
      return {
        series: (raw.results ?? []).map((row) => ({
          date: String(row?.[0] ?? ''),
          count: Number(row?.[1] ?? 0),
        })),
      };
    } catch (err) {
      throw this.upstreamError(err, 'trends');
    }
  }

  // Retention is decoupled from the page-level timeframe selector — always
  // 8 weeks, matching the cloud path.
  async getRetention(): Promise<PosthogRetentionResponse> {
    const conn = await this.requireConnection();
    try {
      const raw = await this.api.runQuery<{
        results?: Array<{
          date?: string;
          label?: string;
          values?: Array<{ count?: number | null }>;
        }>;
      }>({
        ...this.scope(conn),
        queryBody: {
          query: {
            kind: 'RetentionQuery',
            retentionFilter: {
              period: 'Week',
              totalIntervals: 8,
              targetEntity: { id: '$pageview', type: 'events' },
              returningEntity: { id: '$pageview', type: 'events' },
            },
          },
        },
      });
      return {
        rows: (raw.results ?? []).map((r) => ({
          date: String(r.date ?? ''),
          label: String(r.label ?? ''),
          values: Array.isArray(r.values)
            ? r.values.map((v) => ({ count: typeof v?.count === 'number' ? v.count : null }))
            : [],
        })),
      };
    } catch (err) {
      throw this.upstreamError(err, 'retention');
    }
  }

  async getRecordings(limit = 10): Promise<PosthogRecordingsResponse> {
    const conn = await this.requireConnection();
    try {
      const raw = await this.api.listRecordings({ ...this.scope(conn), limit });
      return {
        items: (raw.results ?? []).map((r) => ({
          id: String(r.id ?? ''),
          distinctId: String(r.distinct_id ?? ''),
          durationSeconds: Number(r.duration ?? r.recording_duration ?? 0),
          startTime: String(r.start_time ?? ''),
          endTime: String(r.end_time ?? ''),
          startUrl: r.start_url === null || r.start_url === undefined ? null : String(r.start_url),
          clickCount: Number(r.click_count ?? 0),
          consoleErrorCount: Number(r.console_error_count ?? 0),
        })),
      };
    } catch (err) {
      throw this.upstreamError(err, 'recordings');
    }
  }

  async createRecordingShare(recordingId: string): Promise<PosthogShareTokenResponse> {
    const conn = await this.requireConnection();
    if (!recordingId) {
      throw new AppError('Recording id is required', 400, ERROR_CODES.INVALID_INPUT);
    }
    try {
      const raw = await this.api.refreshRecordingShare({
        ...this.scope(conn),
        recordingId,
      });
      if (!raw?.access_token) {
        throw new AppError(
          'PostHog did not return an access_token',
          502,
          ERROR_CODES.UPSTREAM_FAILURE
        );
      }
      // Regional host, not app.posthog.com: PostHog's own embed example uses
      // `https://us.posthog.com/embedded/<token>`, and an EU recording is not
      // readable cross-region. cloud-backend hardcodes app.posthog.com here.
      return { embedUrl: `${conn.host}/embedded/${raw.access_token}` };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw this.upstreamError(err, 'recording-share');
    }
  }
}
