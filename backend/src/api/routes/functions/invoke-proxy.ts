import { Request, Response, RequestHandler } from 'express';
import fetch from 'node-fetch';
import { isValidFunctionSlug } from '@insforge/shared-schemas';
import { FunctionService } from '@/services/functions/function.service.js';
import { appConfig } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';

/**
 * Request headers that must not be forwarded to the function host.
 *
 * - `cookie`: the backend's only cookies are httpOnly refresh tokens; a function
 *   (or a third-party Subhosting provider) must never see them, and a browser
 *   calling this path with `credentials: 'include'` would otherwise leak any
 *   cookie scoped to the API domain.
 * - `host`, `content-length`: rewritten for the upstream request.
 * - hop-by-hop headers (RFC 7230 §6.1): meaningless across a proxy hop.
 *
 * `authorization` and `x-api-key` are intentionally forwarded: functions act on
 * behalf of the caller and need the bearer token the SDK sends.
 */
export const PROXY_STRIPPED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'cookie',
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Response headers dropped because Express/node-fetch recompute or own them. */
const PROXY_STRIPPED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  'transfer-encoding',
  'content-length',
  'connection',
  'content-encoding',
]);

export function buildProxyRequestHeaders(
  incoming: Request['headers'],
  targetHost: string
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value !== 'string') {
      continue;
    }
    if (PROXY_STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    headers[key] = value;
  }
  headers.host = targetHost;
  return headers;
}

/**
 * Resolve the upstream URL for a slug and assert it stays on the function host.
 * Express decodes `%2F` in route params, so a raw slug such as `//evil.com`
 * would otherwise let `new URL('/' + slug, base)` switch hosts (SSRF).
 * Callers must validate the slug first; the origin check is defence in depth.
 */
export function resolveFunctionTargetUrl(slug: string, baseUrl: string, search: string): URL {
  if (!isValidFunctionSlug(slug)) {
    throw new Error(`Invalid function slug: ${slug}`);
  }
  const base = new URL(baseUrl);
  const target = new URL(`/${encodeURIComponent(slug)}`, base);
  if (target.origin !== base.origin) {
    throw new Error(`Function target ${target.origin} does not match ${base.origin}`);
  }
  target.search = search;
  return target;
}

export interface FunctionInvokeProxyDeps {
  fetchImpl?: typeof fetch;
  getBaseUrl?: () => Promise<string>;
}

async function defaultGetBaseUrl(): Promise<string> {
  const functionService = FunctionService.getInstance();
  const localRuntime = appConfig.functions.denoRuntimeUrl;
  // Prefer Subhosting deployment, fallback to local runtime
  return (
    (functionService.isSubhostingConfigured() && (await functionService.getDeploymentUrl())) ||
    localRuntime
  );
}

/**
 * Legacy `/functions/:slug` invoke proxy (kept for backward compatibility; the
 * SDK is expected to call the edge function host directly).
 * Unauthenticated by design: functions decide for themselves whether the
 * forwarded `authorization` header is required.
 */
export function createFunctionInvokeProxy(deps: FunctionInvokeProxyDeps = {}): RequestHandler {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const getBaseUrl = deps.getBaseUrl ?? defaultGetBaseUrl;

  const handler = async (req: Request, res: Response): Promise<void> => {
    const { slug } = req.params;

    // Reject anything that is not a slug before touching the network. 404 (not
    // 400) so probing the proxy reveals nothing a missing function would not.
    if (typeof slug !== 'string' || !isValidFunctionSlug(slug)) {
      res.status(404).json({ error: 'Function not found' });
      return;
    }

    try {
      const baseUrl = await getBaseUrl();
      const search = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`).search;
      const targetUrl = resolveFunctionTargetUrl(slug, baseUrl, search);
      const headers = buildProxyRequestHeaders(req.headers, targetUrl.host);

      const response = await fetchImpl(targetUrl, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
      });

      // Read response as raw bytes to preserve binary data (images, PDFs, etc.)
      const responseBody = Buffer.from(await response.arrayBuffer());

      // Forward response headers, excluding:
      // - transfer-encoding, content-length: recalculated by Express
      // - connection: hop-by-hop header
      // - content-encoding: node-fetch already decompresses the response,
      //   so we must not tell the client it's still compressed
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of response.headers.entries()) {
        if (PROXY_STRIPPED_RESPONSE_HEADERS.has(key)) {
          continue;
        }
        responseHeaders[key] = value;
      }

      res
        .status(response.status)
        .set(responseHeaders)
        .set('Access-Control-Allow-Origin', '*')
        .send(responseBody);
    } catch (error) {
      logger.error('Failed to proxy function', { slug, error: String(error) });
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}
