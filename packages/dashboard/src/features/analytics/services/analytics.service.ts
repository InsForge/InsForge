import type {
  GetPosthogConnectionResponse,
  PosthogTimeframe,
  PosthogWebOverviewResponse,
  PosthogWebStatsResponse,
  PosthogTrendsResponse,
  PosthogRetentionResponse,
  PosthogRecordingsResponse,
  PosthogShareTokenResponse,
  PosthogConfig,
  PosthogDiscoveredProject,
  PosthogRegion,
} from '@insforge/shared-schemas';
import { apiClient } from '#lib/api/client';

export type Breakdown = 'Page' | 'Country' | 'DeviceType';
export type TrendMetric = 'visitors' | 'views' | 'bounce_rate';

export const analyticsService = {
  async getConnection(): Promise<GetPosthogConnectionResponse | null> {
    try {
      const res = await apiClient.request('/analytics/connection', {
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

  async disconnect(): Promise<void> {
    await apiClient.request('/analytics/connection', {
      method: 'DELETE',
      headers: apiClient.withAccessToken({}),
    });
  },

  // v2.5 endpoints --------------------------------------------------------

  async getWebOverview(timeframe: PosthogTimeframe): Promise<PosthogWebOverviewResponse> {
    const params = new URLSearchParams({ timeframe });
    return apiClient.request(`/analytics/web-overview?${params.toString()}`, {
      headers: apiClient.withAccessToken({}),
    }) as Promise<PosthogWebOverviewResponse>;
  },

  async getWebStats(
    breakdown: Breakdown,
    timeframe: PosthogTimeframe
  ): Promise<PosthogWebStatsResponse> {
    const params = new URLSearchParams({ breakdown, timeframe });
    return apiClient.request(`/analytics/web-stats?${params.toString()}`, {
      headers: apiClient.withAccessToken({}),
    }) as Promise<PosthogWebStatsResponse>;
  },

  async getTrend(metric: TrendMetric, timeframe: PosthogTimeframe): Promise<PosthogTrendsResponse> {
    const params = new URLSearchParams({ metric, timeframe });
    return apiClient.request(`/analytics/trends?${params.toString()}`, {
      headers: apiClient.withAccessToken({}),
    }) as Promise<PosthogTrendsResponse>;
  },

  async getRetention(): Promise<PosthogRetentionResponse> {
    // Decoupled from page timeframe — backend hardcodes weekly cohorts.
    return apiClient.request(`/analytics/retention`, {
      headers: apiClient.withAccessToken({}),
    }) as Promise<PosthogRetentionResponse>;
  },

  async getRecordings(limit = 10): Promise<PosthogRecordingsResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    return apiClient.request(`/analytics/recordings?${params.toString()}`, {
      headers: apiClient.withAccessToken({}),
    }) as Promise<PosthogRecordingsResponse>;
  },

  async createRecordingShare(recordingId: string): Promise<PosthogShareTokenResponse> {
    return apiClient.request(`/analytics/recordings/${encodeURIComponent(recordingId)}/share`, {
      method: 'POST',
      headers: apiClient.withAccessToken({}),
    }) as Promise<PosthogShareTokenResponse>;
  },

  // Self-hosting only — cloud projects answer 400 here and connect via OAuth.

  // Lists the PostHog projects a candidate key can reach. Nothing is stored, so
  // this doubles as the credential test: a bad key fails here, before the user
  // has committed to anything.
  async listPosthogProjects(
    personalApiKey: string,
    region: PosthogRegion
  ): Promise<PosthogDiscoveredProject[]> {
    const res = (await apiClient.request('/analytics/config/projects', {
      method: 'POST',
      headers: apiClient.withAccessToken({}),
      body: JSON.stringify({ personalApiKey, region }),
    })) as { projects?: PosthogDiscoveredProject[] };
    return res?.projects ?? [];
  },

  async updatePosthogConfig(input: {
    personalApiKey: string;
    region: PosthogRegion;
    posthogProjectId?: string;
  }): Promise<PosthogConfig> {
    return apiClient.request('/analytics/config', {
      method: 'PUT',
      headers: apiClient.withAccessToken({}),
      body: JSON.stringify(input),
    }) as Promise<PosthogConfig>;
  },
};
