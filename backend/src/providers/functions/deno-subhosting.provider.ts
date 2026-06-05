import { AppError, UpstreamError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { config } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';
import { z } from 'zod';
import fetch, { RequestInit, Response } from 'node-fetch';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Ambient declaration for the Deno isolate IPC dispatch binding.
// This global is intentionally set on globalThis inside each generated
// Deno router script so the InsForge host can reach into the isolate
// for in-process function invocation. Typing it here prevents any
// TypeScript code in this module from resorting to `(globalThis as any)`.
declare global {
  var __insforge_dispatch__: ((req: Request) => Promise<Response>) | undefined;
}

const DENO_SUBHOSTING_API_BASE = 'https://api.deno.com/v2';
const DEFAULT_TIMEOUT_MS = 10000;

// Exponential backoff schedule for 429 (rate-limited) responses, in ms.
// Deno Subhosting doesn't always surface Retry-After, so we fall back to this
// schedule. When Retry-After is present we honour it (taking the max of the
// header value and the scheduled backoff), plus a small jitter.
const DEFAULT_RATE_LIMIT_BACKOFF_MS = [1000, 2000, 4000];

// Cap on a single 429 retry wait so a misbehaving upstream that returns
// `Retry-After: 600` cannot park a worker for 10 minutes. Mirrors the
// Vercel helper's `maxDelayMs` default.
const MAX_RETRY_AFTER_MS = 30_000;

export function parseRetryAfterMs(header: string | null): number {
  if (!header) {
    return NaN;
  }
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10) * 1000;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) {
    return NaN;
  }
  return Math.max(0, dateMs - Date.now());
}

/**
 * Fetch with timeout, retry for transient network errors (DNS/socket), and
 * a separate retry layer for HTTP 429 (rate-limited) responses with
 * exponential backoff that honours `Retry-After`.
 *
 * The 429 retries sit INSIDE each network-attempt: if a fetch succeeds
 * network-wise but returns 429, we retry with backoff according to
 * `rateLimitBackoffMs`. If retries are exhausted while the response is still
 * 429, we throw `AppError(429, RATE_LIMITED)` so the rate-limit signal
 * surfaces to the client (the generic `!response.ok` paths in the callers
 * would otherwise flatten it to `500 INTERNAL_ERROR`). Mirrors the Vercel
 * helper's behaviour.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  maxRetries: number = 2,
  rateLimitBackoffMs: number[] = DEFAULT_RATE_LIMIT_BACKOFF_MS
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const fetchPromise = fetch(url, {
      ...options,
      signal: controller.signal,
    });

    try {
      const initialResponse = await Promise.race([fetchPromise, timeoutPromise]);
      // Initial fetch returned; outer timer is no longer relevant. Cancel it so
      // the 429 inner-loop delays don't keep a dangling handle.
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      let currentResponse = initialResponse;

      // 429-aware retry layer. Runs only when the initial response is 429.
      if (currentResponse.status === 429) {
        for (let r = 0; r < rateLimitBackoffMs.length; r++) {
          // Drain the previous 429 body so node-fetch can release the connection.
          if (currentResponse.body) {
            currentResponse.body.resume();
          }
          const retryAfter = currentResponse.headers.get('retry-after');
          const retryAfterMs = parseRetryAfterMs(retryAfter);
          const baseMs = !isNaN(retryAfterMs)
            ? Math.min(Math.max(retryAfterMs, rateLimitBackoffMs[r]), MAX_RETRY_AFTER_MS)
            : rateLimitBackoffMs[r];
          const delay = Math.min(baseMs + Math.floor(Math.random() * 250), MAX_RETRY_AFTER_MS);
          logger.warn('Deno Subhosting 429 — retrying', {
            url,
            attempt: r + 1,
            delayMs: delay,
          });
          await new Promise((res) => setTimeout(res, delay));

          const retryController = new AbortController();
          const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
          try {
            currentResponse = await fetch(url, {
              ...options,
              signal: retryController.signal,
            });
            if (currentResponse.status !== 429) {
              break;
            }
          } finally {
            clearTimeout(retryTimeoutId);
          }
        }

        // If we exhausted every retry and still hold a 429, surface the
        // rate-limit signal to the caller. Otherwise their generic
        // `if (!response.ok)` branch would re-package it as 500.
        if (currentResponse.status === 429) {
          if (currentResponse.body) {
            currentResponse.body.resume();
          }
          throw new AppError(
            'Deno Subhosting rate limit exceeded after retries. Please retry shortly.',
            429,
            ERROR_CODES.RATE_LIMITED
          );
        }
      }

      return currentResponse;
    } catch (error) {
      // Check if this was a timeout (abort) vs other error
      if (controller.signal.aborted) {
        lastError = new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
      } else {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // Retry on DNS/network errors (EAI_AGAIN, ECONNRESET, etc.)
      const isRetryable =
        lastError.message.includes('EAI_AGAIN') ||
        lastError.message.includes('ECONNRESET') ||
        lastError.message.includes('ETIMEDOUT');

      if (!isRetryable || attempt === maxRetries) {
        throw lastError;
      }
      // Wait briefly before retry
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  throw lastError;
}

// ============================================
// Schemas (with runtime validation)
// ============================================

interface DenoSubhostingCredentials {
  token: string;
  organizationId: string;
}

export const functionDefinitionSchema = z.object({
  slug: z.string().min(1),
  code: z.string().min(1),
});

export type FunctionDefinition = z.infer<typeof functionDefinitionSchema>;

const deploymentStatusSchema = z.enum(['pending', 'success', 'failed']);

export const functionDeploymentResultSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: deploymentStatusSchema,
  url: z.string().nullable(),
  createdAt: z.coerce.date(),
});

export type FunctionDeploymentResult = z.infer<typeof functionDeploymentResultSchema>;

interface DenoSubhostingAsset {
  kind: 'file';
  content: string;
  encoding: 'utf-8';
}

// App log types (v2: GET /v2/apps/{app}/logs)
export interface AppLogQueryOptions {
  // `start` is required by the v2 API; getDeploymentAppLogs supplies a default
  // window when the caller omits it.
  start?: string;
  end?: string;
  level?: string;
  query?: string;
  limit?: number;
  cursor?: string;
}

// Raw v2 RuntimeLog entry shape. Note `timestamp` (v1 used `time`) and that
// `region` is optional in v2.
const runtimeLogSchema = z.object({
  timestamp: z.string(),
  level: z.string(),
  message: z.string(),
  region: z.string().optional(),
  revision_id: z.string().optional(),
});

// v2 wraps logs in an object with body-level pagination (v1 used a Link header).
const runtimeLogsResponseSchema = z.object({
  logs: z.array(runtimeLogSchema),
  next_cursor: z.string().nullable().optional(),
});

// Normalized entry returned to callers (stable across the v1→v2 migration so
// log.service doesn't need to know the wire shape).
export interface AppLogEntry {
  time: string;
  level: string;
  message: string;
  region: string;
}

export interface AppLogResult {
  logs: AppLogEntry[];
  cursor: string | null;
  hasMore: boolean;
}

// Build log types
export interface BuildLogEntry {
  level: string;
  message: string;
}

// v2 Revision response (POST /v2/apps/{app}/deploy, GET /v2/revisions/{id}).
// Renamed from v1's `deployment`; snake_case; no `domains`/`projectId` fields.
// Deno still doesn't return error details here — they come from build logs.
const revisionResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['skipped', 'queued', 'building', 'succeeded', 'failed']),
  failure_reason: z.string().nullable().optional(),
  created_at: z.string(),
});

type RevisionStatus = z.infer<typeof revisionResponseSchema>['status'];

// Collapse the v2 revision lifecycle to the coarse status our DB and callers
// use ('pending' | 'success' | 'failed'), keeping the provider's public contract
// stable. `skipped` means "no changes to deploy" — treat as a successful no-op.
function mapRevisionStatus(status: RevisionStatus): 'pending' | 'success' | 'failed' {
  if (status === 'succeeded' || status === 'skipped') {
    return 'success';
  }
  if (status === 'failed') {
    return 'failed';
  }
  return 'pending'; // queued | building
}

export class DenoSubhostingProvider {
  private static instance: DenoSubhostingProvider;

  private constructor() {}

  static getInstance(): DenoSubhostingProvider {
    if (!DenoSubhostingProvider.instance) {
      DenoSubhostingProvider.instance = new DenoSubhostingProvider();
    }
    return DenoSubhostingProvider.instance;
  }

  /**
   * Check if Deno Subhosting is properly configured
   */
  isConfigured(): boolean {
    const { token, organizationId } = config.denoSubhosting;
    return !!(token && organizationId);
  }

  /**
   * Get Deno Subhosting credentials from config
   */
  getCredentials(): DenoSubhostingCredentials {
    const { token, organizationId } = config.denoSubhosting;

    if (!token) {
      throw new AppError('DENO_SUBHOSTING_TOKEN not configured', 500, ERROR_CODES.INTERNAL_ERROR);
    }
    if (!organizationId) {
      throw new AppError('DENO_SUBHOSTING_ORG_ID not configured', 500, ERROR_CODES.INTERNAL_ERROR);
    }

    return { token, organizationId };
  }

  /**
   * Ensure the Deno app exists, creating it if not.
   *
   * The app slug = APP_KEY. Combined with our org slug (`insforge`), Deno serves
   * the app at `{slug}.insforge.deno.net`; the public function URL is the
   * CloudFront proxy in front of that (see docs/deno-subhosting.md §4.1).
   */
  private async ensureApp(slug: string): Promise<void> {
    const credentials = this.getCredentials();

    // Check if the app exists
    const checkResponse = await fetchWithTimeout(`${DENO_SUBHOSTING_API_BASE}/apps/${slug}`, {
      headers: { Authorization: `Bearer ${credentials.token}` },
    });

    if (checkResponse.ok) {
      return; // App exists
    }

    if (checkResponse.status !== 404) {
      throw new UpstreamError(
        {
          response: {
            status: checkResponse.status,
            statusText: checkResponse.statusText,
            data: await checkResponse.text(),
          },
        },
        'Failed to check app'
      );
    }

    // Create the app. v2 binds the token to one org, so there is no org in the
    // path; the slug travels in the body.
    logger.info('Creating Deno Deploy app', { slug });

    const createResponse = await fetchWithTimeout(`${DENO_SUBHOSTING_API_BASE}/apps`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ slug }),
    });

    if (!createResponse.ok) {
      throw new UpstreamError(
        {
          response: {
            status: createResponse.status,
            statusText: createResponse.statusText,
            data: await createResponse.text(),
          },
        },
        'Failed to create app'
      );
    }

    logger.info('Deno Deploy app created', { slug });
  }

  /**
   * Build the public function URL for an app slug. Points at the CloudFront
   * proxy domain (config.denoSubhosting.domain, e.g. `function2.insforge.app`),
   * which forwards to `{slug}.insforge.deno.net`.
   */
  private getFunctionUrl(slug: string): string {
    return `https://${slug}.${config.denoSubhosting.domain}`;
  }

  /**
   * Type-check a single function's code with `deno check`.
   * Runs the transformed code (after legacy conversion) so it catches
   * require(), bad imports, syntax errors, etc. before saving to DB.
   * Only runs in cloud environments where Deno Subhosting is configured.
   * Skips gracefully if Deno is not installed.
   */
  async checkCode(userCode: string, slug: string): Promise<void> {
    if (!this.isConfigured()) {
      return;
    }

    const transformed = this.transformUserCode(userCode, slug);
    const tempDir = await mkdtemp(join(tmpdir(), 'insforge-deno-check-'));

    try {
      await writeFile(
        join(tempDir, 'deno.json'),
        '{"nodeModulesDir":"auto","compilerOptions":{"noImplicitAny":false}}',
        'utf-8'
      );
      await writeFile(join(tempDir, 'func.ts'), transformed, 'utf-8');

      await execFileAsync('deno', ['check', '--no-lock', 'func.ts'], {
        cwd: tempDir,
        timeout: 60_000,
        env: { ...process.env, NO_COLOR: '1' },
      });
    } catch (error: unknown) {
      const execError = error as { stderr?: string; stdout?: string; code?: string };

      // Type-check failure — deno ran but found errors
      const output = (execError.stderr || execError.stdout || '').trim();
      if (output) {
        throw new AppError(
          `Function code failed type check:\n${output}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      // Deno binary not installed — skip gracefully
      if (execError.code === 'ENOENT') {
        logger.warn('Deno binary not found, skipping type check');
        return;
      }

      // Any other error (ENOSPC, EACCES, timeout) — don't swallow
      throw new AppError(
        `Deno type check failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Deploy functions to Deno Subhosting
   *
   * Creates a multi-file deployment with:
   * - main.ts: Router that handles path-based routing
   * - functions/{slug}.ts: Individual function files
   */
  async deployFunctions(
    projectId: string,
    functions: FunctionDefinition[],
    secrets: Record<string, string> = {}
  ): Promise<FunctionDeploymentResult> {
    const credentials = this.getCredentials();

    try {
      // Ensure the app exists
      await this.ensureApp(projectId);

      // Build assets map
      const assets: Record<string, DenoSubhostingAsset> = {
        'main.ts': {
          kind: 'file',
          content: this.generateRouter(functions),
          encoding: 'utf-8',
        },
      };

      // Add each function file
      const VALID_SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;
      for (const func of functions) {
        if (!VALID_SLUG_PATTERN.test(func.slug)) {
          throw new AppError(
            `Invalid function slug: "${func.slug}" - must be alphanumeric with hyphens or underscores only`,
            400,
            ERROR_CODES.INVALID_INPUT
          );
        }
        assets[`functions/${func.slug}.ts`] = {
          kind: 'file',
          content: this.transformUserCode(func.code, func.slug),
          encoding: 'utf-8',
        };
      }

      logger.info('Deploying to Deno Subhosting', {
        projectId,
        functionCount: functions.length,
        functions: functions.map((f) => f.slug),
        secretCount: Object.keys(secrets).length,
      });

      const payload = {
        assets,
        // v2 moves the entrypoint into config.runtime; `dynamic` runs a Deno
        // process (vs. `static` file serving). No `domains` field exists in v2 —
        // custom-domain routing is handled by the CloudFront proxy instead.
        config: {
          runtime: { type: 'dynamic', entrypoint: 'main.ts' },
        },
        // v2 takes env vars as an array of {key, value} (was a Record in v1).
        // Accessible via Deno.env.get('KEY').
        env_vars: Object.entries(secrets).map(([key, value]) => ({ key, value })),
      };

      const response = await fetchWithTimeout(
        `${DENO_SUBHOSTING_API_BASE}/apps/${projectId}/deploy`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credentials.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
        30000 // 30s timeout for deployments (larger payload)
      );

      if (!response.ok) {
        logger.error('Deno Subhosting API error', {
          status: response.status,
          statusText: response.statusText,
          projectId,
        });
        throw new UpstreamError(
          {
            response: {
              status: response.status,
              statusText: response.statusText,
              data: await response.text(),
            },
          },
          'Deno Subhosting failed'
        );
      }

      const data = revisionResponseSchema.parse(await response.json());
      const status = mapRevisionStatus(data.status);

      logger.info('Deno Subhosting deployment created', {
        revisionId: data.id,
        projectId,
        status,
        denoStatus: data.status,
      });

      return {
        id: data.id,
        projectId,
        status,
        url: this.getFunctionUrl(projectId),
        createdAt: new Date(data.created_at),
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to deploy to Deno Subhosting', {
        error: error instanceof Error ? error.message : String(error),
        projectId,
      });
      throw new UpstreamError(error, 'Failed to deploy to Deno Subhosting');
    }
  }

  /**
   * Get deployment status by deployment ID
   */
  async getDeployment(deploymentId: string): Promise<FunctionDeploymentResult> {
    const credentials = this.getCredentials();

    try {
      const response = await fetchWithTimeout(
        `${DENO_SUBHOSTING_API_BASE}/revisions/${deploymentId}`,
        {
          headers: {
            Authorization: `Bearer ${credentials.token}`,
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new AppError(
            `Deployment not found: ${deploymentId}`,
            404,
            ERROR_CODES.FUNCTION_DEPLOYMENT_NOT_FOUND
          );
        }
        throw new UpstreamError(
          {
            response: {
              status: response.status,
              statusText: response.statusText,
              data: await response.text(),
            },
          },
          'Failed to get deployment'
        );
      }

      const data = revisionResponseSchema.parse(await response.json());
      const status = mapRevisionStatus(data.status);

      // v2 revisions carry no app slug or domain; the URL is deterministic from
      // our app slug (= APP_KEY). Only surface it once the revision succeeds.
      const slug = config.cloud.appKey;

      return {
        id: data.id,
        projectId: slug,
        status,
        url: status === 'success' ? this.getFunctionUrl(slug) : null,
        createdAt: new Date(data.created_at),
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to get Deno Subhosting deployment', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
      throw new UpstreamError(error, 'Failed to get Deno Subhosting deployment');
    }
  }

  /**
   * Get deployment runtime/execution logs (app logs)
   * These are the actual console output from running functions,
   * unlike build logs which come from the deployment process.
   */
  async getDeploymentAppLogs(
    deploymentId: string,
    options: AppLogQueryOptions = {}
  ): Promise<AppLogResult> {
    const credentials = this.getCredentials();

    try {
      // v2 logs are app-scoped (`/apps/{slug}/logs`) and filtered by revision.
      // `deploymentId` is the revision id; the app slug is our APP_KEY.
      const slug = config.cloud.appKey;

      // v2 requires a `start`. Default to a 24h window ending at `end` (or now)
      // so "latest logs" requests keep working without the caller computing it.
      const end = options.end ?? new Date().toISOString();
      const start = options.start ?? new Date(Date.parse(end) - 24 * 60 * 60 * 1000).toISOString();

      const params = new URLSearchParams();
      params.set('start', start);
      params.set('end', end);
      params.set('revision_id', deploymentId);
      if (options.query) {
        params.set('query', options.query);
      }
      if (options.level) {
        params.set('level', options.level);
      }
      if (options.limit !== undefined) {
        params.set('limit', String(options.limit));
      }
      if (options.cursor) {
        params.set('cursor', options.cursor);
      }

      const url = `${DENO_SUBHOSTING_API_BASE}/apps/${slug}/logs?${params.toString()}`;

      const response = await fetchWithTimeout(
        url,
        {
          headers: {
            Authorization: `Bearer ${credentials.token}`,
            Accept: 'application/json',
          },
        },
        6000
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new AppError(
            `Deployment not found: ${deploymentId}`,
            404,
            ERROR_CODES.FUNCTION_DEPLOYMENT_NOT_FOUND
          );
        }
        throw new UpstreamError(
          {
            response: {
              status: response.status,
              statusText: response.statusText,
              data: await response.text(),
            },
          },
          'Failed to get app logs'
        );
      }

      const data = runtimeLogsResponseSchema.parse(await response.json());
      const logs: AppLogEntry[] = data.logs.map((entry) => ({
        time: entry.timestamp,
        level: entry.level,
        message: entry.message,
        region: entry.region ?? '',
      }));
      const cursor = data.next_cursor ?? null;

      return {
        logs,
        cursor,
        hasMore: cursor !== null,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to get deployment app logs', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
      throw new UpstreamError(error, 'Failed to get deployment app logs');
    }
  }

  /**
   * Get deployment build logs (structured)
   */
  async getDeploymentBuildLogs(deploymentId: string): Promise<BuildLogEntry[]> {
    const credentials = this.getCredentials();

    try {
      const response = await fetchWithTimeout(
        `${DENO_SUBHOSTING_API_BASE}/revisions/${deploymentId}/build_logs`,
        {
          headers: {
            Authorization: `Bearer ${credentials.token}`,
            Accept: 'application/x-ndjson',
          },
        }
      );

      if (!response.ok) {
        return [];
      }

      const text = await response.text();
      // Parse NDJSON format
      return text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          try {
            const parsed = JSON.parse(line);
            return {
              level: parsed.level || 'info',
              message: parsed.message || line,
            };
          } catch {
            return { level: 'info', message: line };
          }
        });
    } catch (error) {
      logger.warn('Failed to get deployment build logs', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
      return [];
    }
  }

  /**
   * Get deployment build logs (legacy string format for backwards compatibility)
   */
  async getDeploymentLogs(deploymentId: string): Promise<string[]> {
    const logs = await this.getDeploymentBuildLogs(deploymentId);
    return logs.map((log) => `[${log.level}] ${log.message}`);
  }

  /**
   * Poll deployment until it reaches a final status (success or failed)
   * Returns the final deployment result with build logs if failed
   */
  async waitForDeployment(
    deploymentId: string,
    maxAttempts = 30,
    intervalMs = 2000
  ): Promise<{
    status: 'success' | 'failed';
    url: string | null;
    buildLogs?: string[];
  }> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const deployment = await this.getDeployment(deploymentId);

      if (deployment.status === 'success') {
        return {
          status: 'success',
          url: deployment.url,
        };
      }

      if (deployment.status === 'failed') {
        // Fetch build logs - this is where error details come from
        const buildLogs = await this.getDeploymentLogs(deploymentId);

        return {
          status: 'failed',
          url: null,
          buildLogs,
        };
      }

      // Still pending, wait and retry
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    // Timeout - treat as failed
    return {
      status: 'failed',
      url: null,
      buildLogs: ['Deployment timed out'],
    };
  }

  /**
   * Transform user code to Deno-compatible format
   *
   * Supports two formats:
   *
   * 1. Legacy (module.exports) - converted automatically, createClient injected:
   *    module.exports = async function(req) { return new Response("Hello"); }
   *
   * 2. Deno-native (export default) - used as-is, user imports directly:
   *    import { createClient } from 'npm:@insforge/sdk';
   *    export default async function(req: Request) { return new Response("Hello"); }
   */
  private transformUserCode(userCode: string, slug: string): string {
    // Legacy format - convert module.exports to export default
    if (userCode.includes('module.exports')) {
      return this.convertLegacyFormat(userCode, slug);
    }

    // Deno-native format - use as-is (user imports directly)
    return `// Function: ${slug}\n${userCode}`;
  }

  /**
   * Convert legacy module.exports format to Deno export default
   * Injects createClient so it's available in scope for legacy code
   *
   * Input:  module.exports = async function(req) { ... }
   * Output: export default async function(req: Request) { ... }
   */
  private convertLegacyFormat(userCode: string, slug: string): string {
    return `// Function: ${slug} (legacy format)
// createClient is injected and available in scope
import { createClient } from 'npm:@insforge/sdk';

declare global {
  var __insforge_dispatch__: (req: Request) => Promise<Response>;
}

const _legacyModule: { exports: unknown } = { exports: {} };
const module = _legacyModule;

${userCode}

export default _legacyModule.exports as (req: Request) => Promise<Response>;

globalThis.__insforge_dispatch__ = (req: Request) => (_legacyModule.exports as (req: Request) => Promise<Response>)(req);
`;
  }

  /**
   * Generate router main.ts that imports all functions
   */
  private generateRouter(functions: FunctionDefinition[]): string {
    if (functions.length === 0) {
      // Empty router when no functions
      return `
// Auto-generated router (no functions)
declare global {
  var __insforge_dispatch__: (req: Request) => Promise<Response>;
}
export {};

const dispatch = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname === "/health" || pathname === "/") {
    return new Response(JSON.stringify({
      status: "ok",
      type: "insforge-functions",
      functions: [],
      timestamp: new Date().toISOString(),
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({
    error: "No functions deployed",
  }), {
    status: 404,
    headers: { "Content-Type": "application/json" }
  });
};

globalThis.__insforge_dispatch__ = dispatch;

Deno.serve(dispatch);
`;
    }

    const imports = functions
      .map((f) => `import ${this.sanitizeSlug(f.slug)} from "./functions/${f.slug}.ts";`)
      .join('\n');

    const routes = functions.map((f) => `  "${f.slug}": ${this.sanitizeSlug(f.slug)},`).join('\n');

    return `
// Auto-generated router
import { AsyncLocalStorage } from 'node:async_hooks';
${imports}

declare global {
  var __insforge_dispatch__: (req: Request) => Promise<Response>;
}

const routes: Record<string, (req: Request) => Promise<Response>> = {
${routes}
};

// Per-request call-depth tracking to catch recursive function invocations
// (in-process dispatch bypasses Deno Subhosting's network-level 508 guard).
const MAX_DEPTH = 8;
const depthStore = new AsyncLocalStorage<number>();

const dispatch = async (req: Request): Promise<Response> => {
  const currentDepth = depthStore.getStore() ?? 0;
  if (currentDepth >= MAX_DEPTH) {
    return new Response(JSON.stringify({
      error: "Loop Detected",
      message: "Function call depth exceeded " + MAX_DEPTH + ". Possible recursive invocation.",
    }), {
      status: 508,
      headers: { "Content-Type": "application/json" }
    });
  }

  return await depthStore.run(currentDepth + 1, async () => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Health check
    if (pathname === "/health" || pathname === "/") {
      return new Response(JSON.stringify({
        status: "ok",
        type: "insforge-functions",
        functions: Object.keys(routes),
        timestamp: new Date().toISOString(),
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Extract function slug
    const pathParts = pathname.split("/").filter(Boolean);
    const slug = pathParts[0];

    if (!slug || !routes[slug]) {
      return new Response(JSON.stringify({
        error: "Function not found",
        available: Object.keys(routes),
      }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Execute function
    try {
      const handler = routes[slug];

      // If there's a subpath, create modified request
      const subpath = pathParts.slice(1).join("/");
      let funcReq = req;
      if (subpath) {
        const newUrl = new URL(req.url);
        newUrl.pathname = "/" + subpath;
        funcReq = new Request(newUrl.toString(), req);
      }

      const startTime = Date.now();
      const response = await handler(funcReq);
      const duration = Date.now() - startTime;

      // Structured JSON log — matches InsForge backend log format:
      // { timestamp, slug, method, status, duration }. Captured by the
      // Deno Subhosting platform from stdout and surfaced as app logs.
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        slug,
        method: req.method,
        status: response.status,
        duration: duration + "ms",
      }));

      return response;
    } catch (error) {
      console.error("Function error:", error);
      return new Response(JSON.stringify({
        error: "Function execution failed",
        message: (error as Error).message,
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
};

// __insforge_dispatch__ bridges the isolate boundary for in-process dispatch.
globalThis.__insforge_dispatch__ = dispatch;

Deno.serve(dispatch);
`;
  }

  /**
   * Sanitize slug to valid JavaScript identifier
   * Prefixes with underscore and replaces hyphens with underscores
   */
  private sanitizeSlug(slug: string): string {
    return `_${slug.replace(/-/g, '_')}`;
  }
}
