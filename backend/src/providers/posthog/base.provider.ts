import type {
  PosthogConnection,
  PosthogDashboardsResponse,
  PosthogSummary,
  PosthogEventsResponse,
} from '@insforge/shared-schemas';

export interface PosthogProvider {
  getConnection(): Promise<PosthogConnection | null>;
  getDashboards(): Promise<PosthogDashboardsResponse>;
  getSummary(): Promise<PosthogSummary>;
  getRecentEvents(limit?: number): Promise<PosthogEventsResponse>;
  disconnect(): Promise<void>;
}
