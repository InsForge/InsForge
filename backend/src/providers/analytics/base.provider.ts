import type {
  PosthogConnection,
  PosthogDashboardsResponse,
  PosthogEventsResponse,
  PosthogRecordingsResponse,
  PosthogRetentionResponse,
  PosthogShareTokenResponse,
  PosthogSummary,
  PosthogTrendsResponse,
  PosthogWebOverviewResponse,
  PosthogWebStatsResponse,
} from '@insforge/shared-schemas';

/**
 * The read surface the Analytics dashboard needs, however the data is reached.
 *
 * Cloud projects proxy to cloud-backend, which owns the OAuth connection;
 * self-hosted deployments talk to PostHog directly with a locally stored
 * personal API key. Both shapes answer identically so the routes and the
 * dashboard stay unaware of which one is live.
 */
export interface AnalyticsProvider {
  getConnection(): Promise<PosthogConnection | null>;
  getDashboards(): Promise<PosthogDashboardsResponse>;
  getSummary(): Promise<PosthogSummary>;
  getRecentEvents(limit?: number): Promise<PosthogEventsResponse>;
  disconnect(): Promise<void>;
  getWebOverview(timeframe: string): Promise<PosthogWebOverviewResponse>;
  getWebStats(breakdown: string, timeframe: string): Promise<PosthogWebStatsResponse>;
  getTrends(metric: string, timeframe: string): Promise<PosthogTrendsResponse>;
  getRetention(): Promise<PosthogRetentionResponse>;
  getRecordings(limit?: number): Promise<PosthogRecordingsResponse>;
  createRecordingShare(recordingId: string): Promise<PosthogShareTokenResponse>;
}
