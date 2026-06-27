import { apiClient } from '#lib/api/client';

// Apify-specific connection shape kept local (not in @insforge/shared-schemas) —
// the connector catalog grows by adding providers, not shared types.
export interface ApifyConnection {
  apifyUsername: string | null;
  plan: string | null;
  // Live account metadata (read from Apify per request, not stored).
  planTier: string | null;
  email: string | null;
  dataRetentionDays: number | null;
  status: 'active' | 'degraded' | 'revoked';
  createdAt: string;
}

export interface ApifyRun {
  id: string;
  actId: string | null;
  // Human-readable actor name (e.g. "apify/google-maps-scraper"), resolved
  // server-side from actId. Null when unavailable.
  actorName: string | null;
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  usageTotalUsd: number | null;
  defaultDatasetId: string | null;
}

export interface ApifyLatestData {
  datasetId: string | null;
  items: unknown[];
  // True when Apify locked the dataset because the account hit its monthly usage
  // limit — distinct from a fetch failure so the UI can prompt an upgrade.
  limitReached: boolean;
}

export const webscraperService = {
  async getApifyConnection(): Promise<ApifyConnection | null> {
    try {
      const res = await apiClient.request('/webscraper/apify/connection', {
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
    await apiClient.request('/webscraper/apify/connection', {
      method: 'DELETE',
      headers: apiClient.withAccessToken({}),
    });
  },

  async getApifyRuns(limit = 10): Promise<ApifyRun[]> {
    const res = await apiClient.request(`/webscraper/apify/runs?limit=${limit}`, {
      headers: apiClient.withAccessToken({}),
    });
    // Drop items without a stable id — they break React keys and would produce
    // bogus `/actors/runs/undefined` links.
    return ((res?.runs ?? []) as ApifyRun[]).filter((r) => typeof r?.id === 'string' && r.id);
  },

  async getApifyLatestData(limit = 5): Promise<ApifyLatestData> {
    const res = await apiClient.request(`/webscraper/apify/data?limit=${limit}`, {
      headers: apiClient.withAccessToken({}),
    });
    return {
      datasetId: res?.datasetId ?? null,
      items: res?.items ?? [],
      limitReached: res?.limitReached === true,
    };
  },
};
