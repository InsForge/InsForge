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
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  usageTotalUsd: number | null;
  defaultDatasetId: string | null;
}

// A scraper the user created or used (actor-first list).
export interface ApifyActor {
  id: string;
  name: string | null;
  title: string | null;
  lastRunStartedAt: string | null;
  totalRuns: number | null;
}

// A stored dataset (run output) the user owns (dataset-first list).
export interface ApifyDataset {
  id: string;
  name: string | null;
  itemCount: number | null;
  createdAt: string | null;
  actId: string | null;
}

export interface ApifyLatestData {
  datasetId: string | null;
  items: unknown[];
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

  async getApifyActors(limit = 20): Promise<ApifyActor[]> {
    const res = await apiClient.request(`/webscraper/apify/actors?limit=${limit}`, {
      headers: apiClient.withAccessToken({}),
    });
    return ((res?.actors ?? []) as ApifyActor[]).filter((a) => typeof a?.id === 'string' && a.id);
  },

  async getApifyDatasets(limit = 20): Promise<ApifyDataset[]> {
    const res = await apiClient.request(`/webscraper/apify/datasets?limit=${limit}`, {
      headers: apiClient.withAccessToken({}),
    });
    return ((res?.datasets ?? []) as ApifyDataset[]).filter(
      (d) => typeof d?.id === 'string' && d.id
    );
  },

  async getApifyRuns(limit = 20): Promise<ApifyRun[]> {
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
    };
  },
};
