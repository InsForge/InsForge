import type {
  GetPosthogConnectionResponse,
  GetPosthogDashboardsResponse,
  PosthogTimeframe,
  PosthogWebOverviewResponse,
  PosthogWebStatsResponse,
  PosthogTrendsResponse,
  PosthogRetentionResponse,
  PosthogRecordingsResponse,
  PosthogShareTokenResponse,
} from '@insforge/shared-schemas';
import { apiClient } from '../../../lib/api/client';

export type Breakdown = 'Page' | 'Country' | 'DeviceType';

export const posthogApi = {
  async getConnection(): Promise<GetPosthogConnectionResponse | null> {
    try {
      const res = await apiClient.request('/integrations/posthog/connection', {
        headers: apiClient.withAccessToken({}),
      });
      return (res?.connection ?? null) as GetPosthogConnectionResponse | null;
    } catch (err: unknown) {
      if ((err as { response?: { status: number } })?.response?.status === 404) {
        return null;
      }
      throw err;
    }
  },

  async getDashboards(): Promise<GetPosthogDashboardsResponse> {
    return apiClient.request('/integrations/posthog/dashboards', {
      headers: apiClient.withAccessToken({}),
    }) as Promise<GetPosthogDashboardsResponse>;
  },

  async disconnect(): Promise<void> {
    await apiClient.request('/integrations/posthog/connection', {
      method: 'DELETE',
      headers: apiClient.withAccessToken({}),
    });
  },

  // v2.5 endpoints --------------------------------------------------------

  async getWebOverview(timeframe: PosthogTimeframe): Promise<PosthogWebOverviewResponse> {
    const params = new URLSearchParams({ timeframe });
    return apiClient.request(`/integrations/posthog/web-overview?${params.toString()}`, {
      headers: apiClient.withAccessToken({}),
    }) as Promise<PosthogWebOverviewResponse>;
  },

  async getWebStats(
    breakdown: Breakdown,
    timeframe: PosthogTimeframe
  ): Promise<PosthogWebStatsResponse> {
    const params = new URLSearchParams({ breakdown, timeframe });
    return apiClient.request(`/integrations/posthog/web-stats?${params.toString()}`, {
      headers: apiClient.withAccessToken({}),
    }) as Promise<PosthogWebStatsResponse>;
  },

  async getPageviewsTrend(timeframe: PosthogTimeframe): Promise<PosthogTrendsResponse> {
    const params = new URLSearchParams({ event: '$pageview', timeframe });
    return apiClient.request(`/integrations/posthog/trends?${params.toString()}`, {
      headers: apiClient.withAccessToken({}),
    }) as Promise<PosthogTrendsResponse>;
  },

  async getRetention(timeframe: PosthogTimeframe): Promise<PosthogRetentionResponse> {
    const params = new URLSearchParams({ timeframe });
    return apiClient.request(`/integrations/posthog/retention?${params.toString()}`, {
      headers: apiClient.withAccessToken({}),
    }) as Promise<PosthogRetentionResponse>;
  },

  async getRecordings(limit = 10): Promise<PosthogRecordingsResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    return apiClient.request(`/integrations/posthog/recordings?${params.toString()}`, {
      headers: apiClient.withAccessToken({}),
    }) as Promise<PosthogRecordingsResponse>;
  },

  async createRecordingShare(recordingId: string): Promise<PosthogShareTokenResponse> {
    return apiClient.request(
      `/integrations/posthog/recordings/${encodeURIComponent(recordingId)}/share`,
      {
        method: 'POST',
        headers: apiClient.withAccessToken({}),
      }
    ) as Promise<PosthogShareTokenResponse>;
  },
};
