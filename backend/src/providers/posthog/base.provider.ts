import type {
  PosthogConnection,
  PosthogDashboardsResponse,
  PosthogSummary,
  PosthogEventsResponse,
  PosthogWebOverviewResponse,
  PosthogWebStatsResponse,
  PosthogTrendsResponse,
  PosthogRetentionResponse,
  PosthogRecordingsResponse,
  PosthogShareTokenResponse,
} from '@insforge/shared-schemas';

export interface PosthogProvider {
  getConnection(): Promise<PosthogConnection | null>;
  getDashboards(): Promise<PosthogDashboardsResponse>;
  getSummary(): Promise<PosthogSummary>;
  getRecentEvents(limit?: number): Promise<PosthogEventsResponse>;
  disconnect(): Promise<void>;

  // v2.5 analytics dashboard endpoints — proxied through to cloud-backend
  // (and ultimately PostHog). LocalPosthogProvider throws not_implemented.
  getWebOverview(timeframe: string): Promise<PosthogWebOverviewResponse>;
  getWebStats(breakdown: string, timeframe: string): Promise<PosthogWebStatsResponse>;
  getTrends(metric: string, timeframe: string): Promise<PosthogTrendsResponse>;
  getRetention(): Promise<PosthogRetentionResponse>;
  getRecordings(limit?: number): Promise<PosthogRecordingsResponse>;
  createRecordingShare(recordingId: string): Promise<PosthogShareTokenResponse>;
}
