import type { PosthogConnection, PosthogDashboardsResponse } from '@insforge/shared-schemas';

export interface PosthogProvider {
  getConnection(): Promise<PosthogConnection | null>;
  getDashboards(): Promise<PosthogDashboardsResponse>;
  disconnect(): Promise<void>;
}
