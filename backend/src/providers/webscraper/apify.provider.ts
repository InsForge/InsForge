import jwt from 'jsonwebtoken';
import axios from 'axios';
import { z } from 'zod';
import { appConfig } from '@/infra/config/app.config.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

// The Apify connection response is small and Apify-specific, so its schema lives
// here rather than in @insforge/shared-schemas. Mirrors PostHogProvider: signs a
// short-lived project JWT and proxies to cloud-backend's project-JWT routes.
export const apifyConnectionSchema = z.object({
  apifyUsername: z.string().nullable(),
  plan: z.string().nullable(),
  // Live account metadata from cloud-backend (/users/me), surfaced on the
  // dashboard. Optional so an older cloud-backend that omits them still parses.
  planTier: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  dataRetentionDays: z.number().nullable().optional(),
  status: z.enum(['active', 'degraded', 'revoked']),
  createdAt: z.string(),
});
export type ApifyConnection = z.infer<typeof apifyConnectionSchema>;

// Envelopes returned by the cloud-backend project routes. Run/dataset item
// shapes are Apify-defined, so items stay `unknown` — we validate the envelope,
// not every field.
const apifyTokenSchema = z.object({ accessToken: z.string() });
const apifyRunsSchema = z.object({ runs: z.array(z.unknown()) });
const apifyActorsSchema = z.object({ actors: z.array(z.unknown()) });
const apifyDatasetsSchema = z.object({ datasets: z.array(z.unknown()) });
const apifyLatestDataSchema = z.object({
  datasetId: z.string().nullable(),
  items: z.array(z.unknown()),
});

export class ApifyProvider {
  private static instance: ApifyProvider;
  private constructor() {}
  static getInstance(): ApifyProvider {
    if (!ApifyProvider.instance) {
      ApifyProvider.instance = new ApifyProvider();
    }
    return ApifyProvider.instance;
  }

  private isEnabled(): boolean {
    return !!appConfig.cloud.projectId && appConfig.cloud.projectId !== 'local';
  }

  private throwUnsupported(): never {
    throw new AppError(
      'Apify integration is only available on Insforge Cloud, not in self-hosted mode.',
      501,
      ERROR_CODES.INTERNAL_ERROR
    );
  }

  private signToken(): string {
    const projectId = appConfig.cloud.projectId;
    const secret = appConfig.app.jwtSecret;
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
    return `${appConfig.cloud.apiHost}/projects/v1/${appConfig.cloud.projectId}${path}`;
  }

  async getConnection(): Promise<ApifyConnection | null> {
    if (!this.isEnabled()) {
      this.throwUnsupported();
    }
    let data: unknown;
    try {
      const response = await axios.get(this.url('/apify/connection'), {
        headers: this.headers(),
        timeout: 10000,
      });
      data = response.data;
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new AppError(
        `Failed to fetch Apify connection: ${msg}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
    const parsed = apifyConnectionSchema.safeParse(data);
    if (!parsed.success) {
      throw new AppError(
        `Invalid Apify connection response: ${parsed.error.message}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
    return parsed.data;
  }

  async disconnect(): Promise<void> {
    if (!this.isEnabled()) {
      this.throwUnsupported();
    }
    try {
      await axios.delete(this.url('/apify/connection'), {
        headers: this.headers(),
        timeout: 10000,
      });
    } catch (err: unknown) {
      // 404 = already gone on the cloud side; treat as success (idempotent),
      // mirroring getConnection()'s 404 handling.
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return;
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      throw new AppError(`Failed to disconnect Apify: ${msg}`, 502, ERROR_CODES.UPSTREAM_FAILURE);
    }
  }

  // Currently-valid (lazily refreshed) access token for the user's own compute.
  async getToken(): Promise<{ accessToken: string } | null> {
    return this.validatedGet('/apify/token', apifyTokenSchema);
  }

  async getRuns(limit: number): Promise<{ runs: unknown[] } | null> {
    return this.validatedGet('/apify/runs', apifyRunsSchema, { limit });
  }

  async getActors(limit: number): Promise<{ actors: unknown[] } | null> {
    return this.validatedGet('/apify/actors', apifyActorsSchema, { limit });
  }

  async getDatasets(limit: number): Promise<{ datasets: unknown[] } | null> {
    return this.validatedGet('/apify/datasets', apifyDatasetsSchema, { limit });
  }

  async getLatestData(
    limit: number
  ): Promise<{ datasetId: string | null; items: unknown[] } | null> {
    return this.validatedGet('/apify/data', apifyLatestDataSchema, { limit });
  }

  // proxyGet + Zod validation: 404 → null; bad 200 shape → 502 (don't leak an
  // unvalidated upstream response through the web scraper contract).
  private async validatedGet<T>(
    path: string,
    schema: z.ZodType<T>,
    params?: Record<string, unknown>
  ): Promise<T | null> {
    const data = await this.proxyGet(path, params);
    if (data === null) {
      return null;
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new AppError(
        `Invalid Apify ${path} response: ${parsed.error.message}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
    return parsed.data;
  }

  // Shared GET proxy: 404 (not connected) → null; other errors → 502.
  private async proxyGet(path: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.isEnabled()) {
      this.throwUnsupported();
    }
    try {
      const response = await axios.get(this.url(path), {
        headers: this.headers(),
        timeout: 15000,
        params,
      });
      return response.data;
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      const upstreamMsg =
        axios.isAxiosError(err) && typeof err.response?.data?.message === 'string'
          ? err.response.data.message
          : err instanceof Error
            ? err.message
            : 'unknown';
      throw new AppError(
        `Failed to fetch Apify ${path}: ${upstreamMsg}`,
        502,
        ERROR_CODES.UPSTREAM_FAILURE
      );
    }
  }
}
