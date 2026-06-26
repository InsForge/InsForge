import { apiClient } from '#lib/api/client';

// Apify-specific connection shape kept local (not in @insforge/shared-schemas) —
// the connector catalog grows by adding providers, not shared types.
export interface ApifyConnection {
  apifyUsername: string | null;
  plan: string | null;
  status: 'active' | 'degraded' | 'revoked';
  createdAt: string;
}

export const datasourceService = {
  async getApifyConnection(): Promise<ApifyConnection | null> {
    try {
      const res = await apiClient.request('/datasources/apify/connection', {
        headers: apiClient.withAccessToken({}),
      });
      return (res?.connection ?? null) as ApifyConnection | null;
    } catch (err: unknown) {
      if ((err as { response?: { status: number } })?.response?.status === 404) {
        return null;
      }
      throw err;
    }
  },

  async disconnectApify(): Promise<void> {
    await apiClient.request('/datasources/apify/connection', {
      method: 'DELETE',
      headers: apiClient.withAccessToken({}),
    });
  },
};
