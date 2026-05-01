import jwt from 'jsonwebtoken';
import axios from 'axios';
import { config } from '@/infra/config/app.config.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  posthogConnectionSchema,
  posthogDashboardsResponseSchema,
  posthogSummarySchema,
  posthogEventsResponseSchema,
  posthogWebOverviewResponseSchema,
  posthogWebStatsResponseSchema,
  posthogTrendsResponseSchema,
  posthogRetentionResponseSchema,
  posthogRecordingsResponseSchema,
  posthogShareTokenResponseSchema,
  type PosthogConnection,
  type PosthogDashboardsResponse,
  type PosthogSummary,
  type PosthogEventsResponse,
  type PosthogWebOverviewResponse,
  type PosthogWebStatsResponse,
  type PosthogTrendsResponse,
  type PosthogRetentionResponse,
  type PosthogRecordingsResponse,
  type PosthogShareTokenResponse,
} from '@insforge/shared-schemas';
import type { PosthogProvider } from './base.provider.js';

export class CloudPosthogProvider implements PosthogProvider {
  private static instance: CloudPosthogProvider;
  private constructor() {}
  static getInstance(): CloudPosthogProvider {
    if (!CloudPosthogProvider.instance) {
      CloudPosthogProvider.instance = new CloudPosthogProvider();
    }
    return CloudPosthogProvider.instance;
  }

  private signToken(): string {
    const projectId = config.cloud.projectId;
    const secret = config.app.jwtSecret;
    if (!projectId || projectId === 'local') {
      throw new AppError(
        'PROJECT_ID not configured; cannot reach cloud backend.',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
    if (!secret) {
      throw new AppError(
        'JWT_SECRET not configured; cannot sign cloud token.',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
    return jwt.sign({ sub: projectId }, secret, { expiresIn: '10m' });
  }

  private headers() {
    return { Authorization: `Bearer ${this.signToken()}` };
  }

  private url(path: string): string {
    return `${config.cloud.apiHost}/projects/v1/${config.cloud.projectId}${path}`;
  }

  async getConnection(): Promise<PosthogConnection | null> {
    try {
      const { data } = await axios.get(this.url('/posthog/connection'), {
        headers: this.headers(),
        timeout: 10000,
      });
      return posthogConnectionSchema.parse(data);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new AppError(
        `Failed to fetch PostHog connection: ${msg}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
  }

  async getDashboards(): Promise<PosthogDashboardsResponse> {
    try {
      const { data } = await axios.get(this.url('/posthog/dashboards'), {
        headers: this.headers(),
        timeout: 10000,
      });
      return posthogDashboardsResponseSchema.parse(data);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        throw new AppError('PostHog not connected', 404, ERROR_CODES.NOT_FOUND);
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new AppError(
        `Failed to fetch PostHog dashboards: ${msg}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
  }

  async getSummary(): Promise<PosthogSummary> {
    try {
      const { data } = await axios.get(this.url('/posthog/summary'), {
        headers: this.headers(),
        timeout: 10000,
      });
      return posthogSummarySchema.parse(data);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        throw new AppError('PostHog not connected', 404, ERROR_CODES.NOT_FOUND);
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new AppError(
        `Failed to fetch PostHog summary: ${msg}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
  }

  async getRecentEvents(limit = 10): Promise<PosthogEventsResponse> {
    try {
      const { data } = await axios.get(this.url('/posthog/events'), {
        headers: this.headers(),
        timeout: 10000,
        params: { limit },
      });
      return posthogEventsResponseSchema.parse(data);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        throw new AppError('PostHog not connected', 404, ERROR_CODES.NOT_FOUND);
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new AppError(
        `Failed to fetch PostHog events: ${msg}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
  }

  async disconnect(): Promise<void> {
    try {
      await axios.delete(this.url('/posthog/connection'), {
        headers: this.headers(),
        timeout: 10000,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new AppError(`Failed to disconnect PostHog: ${msg}`, 502, ERROR_CODES.UPSTREAM_FAILURE);
    }
  }

  async getWebOverview(timeframe: string): Promise<PosthogWebOverviewResponse> {
    try {
      const { data } = await axios.get(this.url('/posthog/web-overview'), {
        headers: this.headers(),
        timeout: 15000,
        params: { timeframe },
      });
      return posthogWebOverviewResponseSchema.parse(data);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        throw new AppError('PostHog not connected', 404, ERROR_CODES.NOT_FOUND);
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new AppError(
        `Failed to fetch PostHog web overview: ${msg}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
  }

  async getWebStats(breakdown: string, timeframe: string): Promise<PosthogWebStatsResponse> {
    try {
      const { data } = await axios.get(this.url('/posthog/web-stats'), {
        headers: this.headers(),
        timeout: 15000,
        params: { breakdown, timeframe },
      });
      return posthogWebStatsResponseSchema.parse(data);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        throw new AppError('PostHog not connected', 404, ERROR_CODES.NOT_FOUND);
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new AppError(
        `Failed to fetch PostHog web stats: ${msg}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
  }

  async getTrends(metric: string, timeframe: string): Promise<PosthogTrendsResponse> {
    try {
      const { data } = await axios.get(this.url('/posthog/trends'), {
        headers: this.headers(),
        timeout: 15000,
        params: { metric, timeframe },
      });
      return posthogTrendsResponseSchema.parse(data);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        throw new AppError('PostHog not connected', 404, ERROR_CODES.NOT_FOUND);
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new AppError(
        `Failed to fetch PostHog trends: ${msg}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
  }

  async getRetention(): Promise<PosthogRetentionResponse> {
    try {
      const { data } = await axios.get(this.url('/posthog/retention'), {
        headers: this.headers(),
        timeout: 15000,
      });
      return posthogRetentionResponseSchema.parse(data);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        throw new AppError('PostHog not connected', 404, ERROR_CODES.NOT_FOUND);
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new AppError(
        `Failed to fetch PostHog retention: ${msg}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
  }

  async getRecordings(limit = 10): Promise<PosthogRecordingsResponse> {
    try {
      const { data } = await axios.get(this.url('/posthog/recordings'), {
        headers: this.headers(),
        timeout: 15000,
        params: { limit },
      });
      return posthogRecordingsResponseSchema.parse(data);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        throw new AppError('PostHog not connected', 404, ERROR_CODES.NOT_FOUND);
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new AppError(
        `Failed to fetch PostHog recordings: ${msg}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
  }

  async createRecordingShare(recordingId: string): Promise<PosthogShareTokenResponse> {
    try {
      const { data } = await axios.post(
        this.url(`/posthog/recordings/${encodeURIComponent(recordingId)}/share`),
        {},
        { headers: this.headers(), timeout: 15000 }
      );
      return posthogShareTokenResponseSchema.parse(data);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        throw new AppError('PostHog not connected', 404, ERROR_CODES.NOT_FOUND);
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new AppError(
        `Failed to create PostHog recording share: ${msg}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
  }
}
