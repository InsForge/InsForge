import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { config } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';
import { z } from 'zod';
import fetch, { RequestInit, Response } from 'node-fetch';

const DENO_SUBHOSTING_API_BASE = 'https://api.deno.com/v1';
const DEFAULT_TIMEOUT_MS = 10000;

// ============================================
// Helper functions
// ============================================

/**
 * Fetch with timeout and retry for transient errors (DNS, network)
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  maxRetries: number = 2
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // add attempt while temporarily failing.
    const controller = new AbortController();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        controller.abort();
        reject(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const fetchPromise = fetch(url, {
      ...options,
      signal: controller.signal,
    });

    try {
      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
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

// App log types
export interface AppLogQueryOptions {
  q?: string;
  level?: string;
  region?: string;
  since?: string;
  until?: string;
  limit?: number;
  order?: 'asc' | 'desc';
  cursor?: string;
}

const appLogEntrySchema = z.object({
  time: z.string(),
  level: z.string(),
  message: z.string(),
  region: z.string(),
});

export type AppLogEntry = z.infer<typeof appLogEntrySchema>;

const appLogResponseSchema = z.array(appLogEntrySchema);

export interface AppLogResult {
  logs: AppLogEntry[];
  cursor: string | null;
  hasMore: boolean;
}

// Schema for Deno Subhosting API response
// Note: Deno doesn't return error details in deployment response
// Error info comes from build logs endpoint
const denoSubhostingApiResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: z.string().transform((s) => {
    if (s === 'success') {
      return 'success' as const;
    }
    if (s === 'failed') {
      return 'failed' as const;
    }
    return 'pending' as const;
  }),
  domains: z.array(z.string()).default([]),
  createdAt: z.string(),
});

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
   * Ensure project exists, create if not
   */
  private async ensureProject(projectId: string): Promise<void> {
    const credentials = this.getCredentials();

    // Check if project exists
    const checkResponse = await fetchWithTimeout(
      `${DENO_SUBHOSTING_API_BASE}/projects/${projectId}`,
      {
        headers: { Authorization: `Bearer ${credentials.token}` },
      }
    );

    if (checkResponse.ok) {
      return; // Project exists
    }

    if (checkResponse.status !== 404) {
      throw new AppError(
        `Failed to check project: ${checkResponse.statusText}`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    // Create project
    logger.info('Creating Deno Subhosting project', { projectId });

    const createResponse = await fetchWithTimeout(
      `${DENO_SUBHOSTING_API_BASE}/organizations/${credentials.organizationId}/projects`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: projectId }),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new AppError(`Failed to create project: ${errorText}`, 500, ERROR_CODES.INTERNAL_ERROR);
    }

    logger.info('Deno Subhosting project created', { projectId });
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
      // Ensure project exists
      await this.ensureProject(projectId);

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
        entryPointUrl: 'main.ts',
        assets,
        // Pass secrets directly as env vars - accessible via Deno.env.get('KEY')
        envVars: secrets,
        // Use template variable for stable subdomain (Subhosting resolves this)
        domains: [`{project.name}.${config.denoSubhosting.domain}`],
      };

      const response = await fetchWithTimeout(
        `${DENO_SUBHOSTING_API_BASE}/projects/${projectId}/deployments`,
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
        const errorText = await response.text();
        logger.error('Deno Subhosting API error', {
          status: response.status,
          error: errorText,
          projectId,
        });
        throw new AppError(
          `Deno Subhosting failed: ${response.status} - ${errorText}`,
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      const data = denoSubhostingApiResponseSchema.parse(await response.json());

      logger.info('Deno Subhosting deployment created', {
        deploymentId: data.id,
        projectId: data.projectId,
        status: data.status,
        domains: data.domains,
      });

      return {
        id: data.id,
        projectId: data.projectId,
        status: data.status,
        url:
          data.domains.length > 0
            ? `https://${data.domains[0]}`
            : `https://${projectId}.${config.denoSubhosting.domain}`,
        createdAt: new Date(data.createdAt),
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to deploy to Deno Subhosting', {
        error: error instanceof Error ? error.message : String(error),
        projectId,
      });
      throw new AppError('Failed to deploy to Deno Subhosting', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get deployment status by deployment ID
   */
  async getDeployment(deploymentId: string): Promise<FunctionDeploymentResult> {
    const credentials = this.getCredentials();

    try {
      const response = await fetchWithTimeout(
        `${DENO_SUBHOSTING_API_BASE}/deployments/${deploymentId}`,
        {
          headers: {
            Authorization: `Bearer ${credentials.token}`,
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new AppError(`Deployment not found: ${deploymentId}`, 404, ERROR_CODES.NOT_FOUND);
        }
        throw new AppError(
          `Failed to get deployment: ${response.statusText}`,
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      const data = denoSubhostingApiResponseSchema.parse(await response.json());

      return {
        id: data.id,
        projectId: data.projectId,
        status: data.status,
        url: data.domains.length > 0 ? `https://${data.domains[0]}` : null,
        createdAt: new Date(data.createdAt),
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to get Deno Subhosting deployment', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
      throw new AppError(
        'Failed to get Deno Subhosting deployment',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
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
      const params = new URLSearchParams();
      if (options.q) {
        params.set('q', options.q);
      }
      if (options.level) {
        params.set('level', options.level);
      }
      if (options.region) {
        params.set('region', options.region);
      }
      if (options.since) {
        params.set('since', options.since);
      }
      if (options.until) {
        params.set('until', options.until);
      }
      if (options.limit !== undefined) {
        params.set('limit', String(options.limit));
      }
      if (options.order) {
        params.set('order', options.order);
      }
      if (options.cursor) {
        params.set('cursor', options.cursor);
      }

      const queryString = params.toString();
      const url = `${DENO_SUBHOSTING_API_BASE}/deployments/${deploymentId}/app_logs${
        queryString ? `?${queryString}` : ''
      }`;

      const response = await fetchWithTimeout(
        url,
        {
          headers: {
            Authorization: `Bearer ${credentials.token}`,
            Accept: 'application/x-ndjson',
          },
        },
        6000
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new AppError(`Deployment not found: ${deploymentId}`, 404, ERROR_CODES.NOT_FOUND);
        }
        const errorText = await response.text();
        throw new AppError(
          `Failed to get app logs: ${response.status} - ${errorText}`,
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      // Parse NDJSON format (newline-delimited JSON)
      const text = await response.text();
      const logs = text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
      const data = appLogResponseSchema.parse(logs);
      const linkHeader = response.headers.get('link');
      const cursor = this.parseCursorFromLinkHeader(linkHeader);

      return {
        logs: data,
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
      throw new AppError('Failed to get deployment app logs', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get deployment build logs
   */
  async getDeploymentLogs(deploymentId: string): Promise<string[]> {
    const credentials = this.getCredentials();

    try {
      const response = await fetchWithTimeout(
        `${DENO_SUBHOSTING_API_BASE}/deployments/${deploymentId}/build_logs`,
        {
          headers: {
            Authorization: `Bearer ${credentials.token}`,
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
            return `[${parsed.level}] ${parsed.message}`;
          } catch {
            return line;
          }
        });
    } catch (error) {
      logger.warn('Failed to get deployment logs', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
      return [];
    }
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

const _legacyModule: { exports: unknown } = { exports: {} };
const module = _legacyModule;

${userCode}

export default _legacyModule.exports as (req: Request) => Promise<Response>;
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
Deno.serve(async (req: Request) => {
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
});
`;
    }

    const imports = functions
      .map((f) => `import ${this.sanitizeSlug(f.slug)} from "./functions/${f.slug}.ts";`)
      .join('\n');

    const routes = functions.map((f) => `  "${f.slug}": ${this.sanitizeSlug(f.slug)},`).join('\n');

    return `
// Auto-generated router
${imports}

const routes: Record<string, (req: Request) => Promise<Response>> = {
${routes}
};

Deno.serve(async (req: Request) => {
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
`;
  }

  /**
   * Parse cursor from RFC 8288 Link header
   * Expected format: <url?cursor=abc123>; rel="next"
   */
  private parseCursorFromLinkHeader(linkHeader: string | null): string | null {
    if (!linkHeader) {
      return null;
    }

    const nextMatch = linkHeader.match(/<[^>]*[?&]cursor=([^&>]+)[^>]*>;\s*rel="next"/);
    if (nextMatch && nextMatch[1]) {
      return decodeURIComponent(nextMatch[1]);
    }

    return null;
  }

  /**
   * Sanitize slug to valid JavaScript identifier
   * Prefixes with underscore and replaces hyphens with underscores
   */
  private sanitizeSlug(slug: string): string {
    return `_${slug.replace(/-/g, '_')}`;
  }
}
