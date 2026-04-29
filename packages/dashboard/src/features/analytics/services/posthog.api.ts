import type {
  GetPosthogConnectionResponse,
  GetPosthogDashboardsResponse,
} from '@insforge/shared-schemas';
import { apiClient } from '../../../lib/api/client';

export const posthogApi = {
  async getConnection(): Promise<GetPosthogConnectionResponse | null> {
    try {
      const res = await apiClient.request('/api/integrations/posthog/connection', {
        headers: apiClient.withAccessToken({}),
      });
      // Backend returns { connected: true, connection: PosthogConnection } on 200
      return (res?.connection ?? null) as GetPosthogConnectionResponse | null;
    } catch (err: unknown) {
      if ((err as { response?: { status: number } })?.response?.status === 404) {
        return null;
      }
      throw err;
    }
  },

  async getDashboards(): Promise<GetPosthogDashboardsResponse> {
    return apiClient.request('/api/integrations/posthog/dashboards', {
      headers: apiClient.withAccessToken({}),
    }) as Promise<GetPosthogDashboardsResponse>;
  },

  async disconnect(): Promise<void> {
    await apiClient.request('/api/integrations/posthog/connection', {
      method: 'DELETE',
      headers: apiClient.withAccessToken({}),
    });
  },
};
