import axios from 'axios';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import type { ApifyConnection, WebscraperProvider } from '@/providers/webscraper/base.provider.js';
import { ApifyConfigService } from '@/services/webscraper/apify-config.service.js';

const APIFY_API_BASE = 'https://api.apify.com/v2';

// Self-hosted counterpart of CloudWebscraperProvider: the developer's own token,
// stored locally, used to call Apify directly. Field mapping mirrors
// cloud-backend's apify.service.ts so both providers return identical shapes.
export class LocalWebscraperProvider implements WebscraperProvider {
  private static instance: LocalWebscraperProvider;

  constructor(private readonly config: ApifyConfigService = ApifyConfigService.getInstance()) {}

  static getInstance(): LocalWebscraperProvider {
    if (!LocalWebscraperProvider.instance) {
      LocalWebscraperProvider.instance = new LocalWebscraperProvider();
    }
    return LocalWebscraperProvider.instance;
  }

  async getConnection(): Promise<ApifyConnection | null> {
    const record = await this.config.getTokenRecord();
    if (!record) {
      return null;
    }
    let account: Record<string, any>;
    try {
      account = await this.apiGetRaw('/users/me', record.token, 10000);
    } catch (err) {
      // A rejected token is a connection state the dashboard can render, not a
      // request failure. Anything else is a genuine upstream problem.
      if (this.isUnauthorized(err)) {
        return {
          apifyUsername: null,
          plan: null,
          planTier: null,
          email: null,
          dataRetentionDays: null,
          status: 'revoked',
          createdAt: record.createdAt,
        };
      }
      throw this.upstreamError('/users/me', err);
    }
    const user = account?.data ?? {};
    return {
      apifyUsername: user.username ?? null,
      plan: user.plan?.id ?? user.plan ?? null,
      planTier: user.plan?.tier ?? null,
      email: user.email ?? null,
      dataRetentionDays:
        typeof user.plan?.dataRetentionDays === 'number' ? user.plan.dataRetentionDays : null,
      status: 'active',
      createdAt: record.createdAt,
    };
  }

  // Called before storing a token so the user learns immediately that it is wrong.
  async verifyToken(token: string): Promise<void> {
    try {
      await this.apiGetRaw('/users/me', token, 10000);
    } catch (err) {
      if (this.isUnauthorized(err)) {
        throw new AppError(
          'Apify rejected this API token. Check it in the Apify Console and try again.',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      throw this.upstreamError('/users/me', err);
    }
  }

  async disconnect(): Promise<void> {
    await this.config.deleteToken();
  }

  async getToken(): Promise<{ accessToken: string } | null> {
    const token = await this.config.getToken();
    return token ? { accessToken: token } : null;
  }

  async getRuns(limit: number): Promise<{ runs: unknown[] } | null> {
    const token = await this.config.getToken();
    if (!token) {
      return null;
    }
    return { runs: await this.fetchRuns(token, limit) };
  }

  async getActors(limit: number): Promise<{ actors: unknown[] } | null> {
    const token = await this.config.getToken();
    if (!token) {
      return null;
    }
    const data = await this.apiGet(
      `/acts?sortBy=stats.lastRunStartedAt&desc=1&limit=${limit}`,
      token
    );
    const items: any[] = data?.data?.items ?? [];
    return {
      actors: items.map((a) => ({
        id: String(a.id),
        name: a.username && a.name ? `${a.username}/${a.name}` : (a.name ?? null),
        title: a.title ?? null,
        lastRunStartedAt: a.stats?.lastRunStartedAt ?? null,
        totalRuns: typeof a.stats?.totalRuns === 'number' ? a.stats.totalRuns : null,
      })),
    };
  }

  async getDatasets(limit: number): Promise<{ datasets: unknown[] } | null> {
    const token = await this.config.getToken();
    if (!token) {
      return null;
    }
    // unnamed=1 so run-generated datasets are included; Apify otherwise returns
    // only explicitly-named ones, hiding most run output.
    const data = await this.apiGet(`/datasets?desc=1&unnamed=1&limit=${limit}`, token);
    const items: any[] = data?.data?.items ?? [];
    return {
      datasets: items.map((d) => ({
        id: String(d.id),
        name: d.name ?? null,
        itemCount: typeof d.itemCount === 'number' ? d.itemCount : null,
        createdAt: d.createdAt ?? null,
        actId: d.actId ?? null,
      })),
    };
  }

  async getLatestData(
    limit: number
  ): Promise<{ datasetId: string | null; items: unknown[] } | null> {
    const token = await this.config.getToken();
    if (!token) {
      return null;
    }
    const runs = await this.fetchRuns(token, 1);
    const datasetId = runs[0]?.defaultDatasetId ?? null;
    if (!datasetId) {
      return { datasetId: null, items: [] };
    }
    const data = await this.apiGet(
      `/datasets/${encodeURIComponent(datasetId)}/items?clean=true&limit=${limit}`,
      token
    );
    return { datasetId, items: Array.isArray(data) ? data : [] };
  }

  private async fetchRuns(
    token: string,
    limit: number
  ): Promise<Array<{ defaultDatasetId: string | null; [k: string]: unknown }>> {
    const data = await this.apiGet(`/actor-runs?desc=1&limit=${limit}`, token);
    const items: any[] = data?.data?.items ?? [];
    return items.map((r) => ({
      id: String(r.id),
      actId: r.actId ?? null,
      status: r.status ?? null,
      startedAt: r.startedAt ?? null,
      finishedAt: r.finishedAt ?? null,
      usageTotalUsd: typeof r.usageTotalUsd === 'number' ? r.usageTotalUsd : null,
      defaultDatasetId: r.defaultDatasetId ?? null,
    }));
  }

  // Data-path helper: any failure is an upstream failure. Callers that need to
  // branch on the HTTP status (getConnection, verifyToken) use apiGetRaw instead,
  // because wrapping the error here would hide the 401 they care about.
  private async apiGet(path: string, token: string, timeout = 15000): Promise<any> {
    try {
      return await this.apiGetRaw(path, token, timeout);
    } catch (err) {
      throw this.upstreamError(path, err);
    }
  }

  private async apiGetRaw(path: string, token: string, timeout = 15000): Promise<any> {
    const response = await axios.get(`${APIFY_API_BASE}${path}`, {
      timeout,
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  }

  private isUnauthorized(err: unknown): boolean {
    return axios.isAxiosError(err) && err.response?.status === 401;
  }

  private upstreamError(path: string, err: unknown): AppError {
    return new AppError(
      `Failed to fetch Apify ${path}: ${this.errorMessage(err)}`,
      502,
      ERROR_CODES.UPSTREAM_FAILURE
    );
  }

  private errorMessage(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as { error?: { message?: string } } | undefined;
      return body?.error?.message ?? err.message ?? 'request failed';
    }
    return err instanceof Error ? err.message : 'unknown error';
  }
}
