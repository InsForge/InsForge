import jwt from 'jsonwebtoken';
import axios from 'axios';
import { config } from '@/infra/config/app.config.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  posthogConnectionSchema,
  posthogDashboardsResponseSchema,
  type PosthogConnection,
  type PosthogDashboardsResponse,
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
}
