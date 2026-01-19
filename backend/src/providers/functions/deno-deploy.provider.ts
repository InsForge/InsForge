import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';

const DENO_DEPLOY_API_BASE = 'https://api.deno.com/v1';

// ============================================
// Types (internal to this provider)
// ============================================

interface DenoDeployCredentials {
  token: string;
  organizationId: string;
}

export interface FunctionDefinition {
  slug: string;
  code: string;
}

export interface FunctionDeploymentResult {
  id: string;
  projectId: string;
  status: 'pending' | 'success' | 'failed';
  url: string | null;
  createdAt: Date;
  error?: {
    code: string;
    message: string;
  };
}

interface DenoDeployAsset {
  kind: 'file';
  content: string;
  encoding: 'utf-8';
}

interface DenoDeployApiResponse {
  id: string;
  projectId: string;
  status: 'pending' | 'success' | 'failed';
  domains: string[];
  createdAt: string;
}

export class DenoDeployProvider {
  private static instance: DenoDeployProvider;

  private constructor() {}

  static getInstance(): DenoDeployProvider {
    if (!DenoDeployProvider.instance) {
      DenoDeployProvider.instance = new DenoDeployProvider();
    }
    return DenoDeployProvider.instance;
  }

  /**
   * Check if Deno Deploy is properly configured
   */
  isConfigured(): boolean {
    if (process.env.DENO_DEPLOY_ENABLED === 'false') {
      return false;
    }
    return !!(process.env.DENO_DEPLOY_TOKEN && process.env.DENO_DEPLOY_ORG_ID);
  }

  /**
   * Get Deno Deploy credentials from environment variables
   */
  getCredentials(): DenoDeployCredentials {
    const token = process.env.DENO_DEPLOY_TOKEN;
    const organizationId = process.env.DENO_DEPLOY_ORG_ID;

    if (!token) {
      throw new AppError(
        'DENO_DEPLOY_TOKEN not found in environment variables',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
    if (!organizationId) {
      throw new AppError(
        'DENO_DEPLOY_ORG_ID not found in environment variables',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    return { token, organizationId };
  }

  /**
   * Ensure project exists, create if not
   */
  private async ensureProject(projectId: string): Promise<void> {
    const credentials = this.getCredentials();

    // Check if project exists
    const checkResponse = await fetch(`${DENO_DEPLOY_API_BASE}/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${credentials.token}` },
    });

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
    logger.info('Creating Deno Deploy project', { projectId });

    const createResponse = await fetch(
      `${DENO_DEPLOY_API_BASE}/organizations/${credentials.organizationId}/projects`,
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

    logger.info('Deno Deploy project created', { projectId });
  }

  /**
   * Deploy functions to Deno Deploy
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
      const assets: Record<string, DenoDeployAsset> = {
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

      logger.info('Deploying to Deno Deploy', {
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
        // Setting domains makes this a production deployment
        domains: [`${projectId}.deno.dev`],
      };

      const response = await fetch(`${DENO_DEPLOY_API_BASE}/projects/${projectId}/deployments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Deno Deploy API error', {
          status: response.status,
          error: errorText,
          projectId,
        });
        throw new AppError(
          `Deno Deploy failed: ${response.status} - ${errorText}`,
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      const data = (await response.json()) as DenoDeployApiResponse;

      logger.info('Deno Deploy deployment created', {
        deploymentId: data.id,
        projectId: data.projectId,
        status: data.status,
        domains: data.domains,
      });

      const domains = data.domains || [];
      return {
        id: data.id,
        projectId: data.projectId,
        status:
          data.status === 'success' ? 'success' : data.status === 'failed' ? 'failed' : 'pending',
        url: domains.length > 0 ? `https://${domains[0]}` : `https://${projectId}.deno.dev`,
        createdAt: new Date(data.createdAt),
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to deploy to Deno Deploy', {
        error: error instanceof Error ? error.message : String(error),
        projectId,
      });
      throw new AppError('Failed to deploy to Deno Deploy', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get deployment status by deployment ID
   */
  async getDeployment(deploymentId: string): Promise<FunctionDeploymentResult> {
    const credentials = this.getCredentials();

    try {
      const response = await fetch(`${DENO_DEPLOY_API_BASE}/deployments/${deploymentId}`, {
        headers: {
          Authorization: `Bearer ${credentials.token}`,
        },
      });

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

      const data = (await response.json()) as DenoDeployApiResponse;
      const domains = data.domains || [];

      return {
        id: data.id,
        projectId: data.projectId,
        status:
          data.status === 'success' ? 'success' : data.status === 'failed' ? 'failed' : 'pending',
        url: domains.length > 0 ? `https://${domains[0]}` : null,
        createdAt: new Date(data.createdAt),
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to get Deno Deploy deployment', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
      throw new AppError('Failed to get Deno Deploy deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get deployment build logs
   */
  async getDeploymentLogs(deploymentId: string): Promise<string[]> {
    const credentials = this.getCredentials();

    try {
      const response = await fetch(
        `${DENO_DEPLOY_API_BASE}/deployments/${deploymentId}/build_logs`,
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
   * Clear cached credentials (no-op, credentials come from env vars)
   */
  clearCredentials(): void {
    // No-op - credentials are read from env vars each time
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
    errorMessage?: string;
    errorFile?: string;
    errorFunction?: string;
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
        // Fetch build logs to get error details
        const logs = await this.getDeploymentLogs(deploymentId);
        const errorDetails = this.parseErrorFromLogs(logs);

        return {
          status: 'failed',
          url: null,
          errorMessage: errorDetails.message,
          errorFile: errorDetails.file,
          errorFunction: errorDetails.function,
          buildLogs: logs,
        };
      }

      // Still pending, wait and retry
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    // Timeout - treat as failed
    return {
      status: 'failed',
      url: null,
      errorMessage: 'Deployment timed out',
    };
  }

  /**
   * Parse error details from build logs
   */
  private parseErrorFromLogs(logs: string[]): {
    message?: string;
    file?: string;
    function?: string;
  } {
    // Find error log entry
    const errorLog = logs.find((log) => log.includes('[error]'));
    if (!errorLog) {
      return {};
    }

    const message = errorLog.replace('[error] ', '');

    // Try to extract file path: "at file:///src/functions/sdk-test.ts:3:10"
    const fileMatch = message.match(/file:\/\/\/src\/([^\s:]+)/);
    const file = fileMatch ? fileMatch[1] : undefined;

    // Extract function slug if it's a function file
    const funcMatch = file?.match(/functions\/([^.]+)\.ts/);
    const func = funcMatch ? funcMatch[1] : undefined;

    return {
      message,
      file,
      function: func,
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
   * Sanitize slug to valid JavaScript identifier
   * Converts hyphens to underscores
   */
  private sanitizeSlug(slug: string): string {
    return slug.replace(/-/g, '_');
  }
}
