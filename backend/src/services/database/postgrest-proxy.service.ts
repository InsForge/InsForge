import axios, { AxiosResponse } from 'axios';
import { HttpAgent, HttpsAgent } from 'agentkeepalive';
import { TokenManager } from '@/infra/security/token.manager.js';
import logger from '@/utils/logger.js';
import { appConfig } from '@/infra/config/app.config.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

const postgrestUrl = appConfig.database.postgrestBaseUrl;

// Connection pooling for PostgREST. maxSockets caps concurrency toward
// PostgREST; requests beyond it queue inside the agent, and queue time counts
// against the axios timeout below.
//
// agentkeepalive (rather than the built-in http.Agent) because of
// freeSocketTimeout: idle sockets are proactively closed after it elapses.
// Keeping it below PostgREST's server-side idle timeout means this process
// always closes an idle connection before the server can, so requests are
// never written to a socket the server has already torn down (the stale
// keep-alive reuse race behind "socket hang up" ECONNRESETs).
//
// keepAliveMsecs (TCP-level SO_KEEPALIVE probe delay, formerly 5000) is
// deliberately left at agentkeepalive's 1000ms default — it is orthogonal to
// the app-level freeSocketTimeout that governs socket reaping.
const maxSockets = appConfig.database.postgrestMaxSockets;
const maxFreeSockets = Math.min(appConfig.database.postgrestMaxFreeSockets, maxSockets);
const freeSocketTimeout = appConfig.database.postgrestFreeSocketTimeoutMs;

const httpAgent = new HttpAgent({
  keepAlive: true,
  maxSockets,
  maxFreeSockets,
  timeout: 10000,
  freeSocketTimeout,
});

const httpsAgent = new HttpsAgent({
  keepAlive: true,
  maxSockets,
  maxFreeSockets,
  timeout: 10000,
  freeSocketTimeout,
});

const postgrestAxios = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 10000,
  maxRedirects: 0,
});

export interface ProxyRequest {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ProxyResponse {
  data: unknown;
  status: number;
  headers: Record<string, unknown>;
}

/**
 * Headers that should not be forwarded to the client
 */
const EXCLUDED_HEADERS = new Set([
  'content-length',
  'transfer-encoding',
  'connection',
  'content-encoding',
]);

/**
 * Timeout-class errors are never retried: by the time the 10s budget is spent
 * the request may already be executing in PostgREST (retrying a write risks a
 * duplicate), and re-running it amplifies load exactly when the database is
 * saturated.
 */
const TIMEOUT_ERROR_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT']);

/**
 * Errors that prove the connection was never established, so the request
 * cannot have reached PostgREST and is safe to retry for any method.
 */
const CONNECTION_NOT_ESTABLISHED_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * Network errors where the request may or may not have reached PostgREST: an
 * ECONNRESET is usually a keep-alive socket closed while idle, but it can
 * also arrive mid-response after a write already committed, and the two are
 * generally indistinguishable here — except when Node flags the socket as
 * reused, which `isStaleSocketReset` handles separately. A missing code is
 * treated the same way.
 */
const AMBIGUOUS_NETWORK_CODES = new Set(['ECONNRESET', 'EPIPE']);

/**
 * Methods safe to replay even when the request may have reached PostgREST.
 * Everything else (POST/PATCH/PUT/DELETE) only retries errors from
 * CONNECTION_NOT_ESTABLISHED_CODES.
 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class PostgrestProxyService {
  private static instance: PostgrestProxyService;
  private tokenManager = TokenManager.getInstance();
  private adminToken: string;
  private anonToken: string;

  private constructor() {
    this.adminToken = this.tokenManager.generatePostgrestAdminToken();
    this.anonToken = this.tokenManager.generatePostgrestAnonToken();
  }

  public static getInstance(): PostgrestProxyService {
    if (!PostgrestProxyService.instance) {
      PostgrestProxyService.instance = new PostgrestProxyService();
    }
    return PostgrestProxyService.instance;
  }

  /**
   * A request may be retried only when replaying it cannot duplicate work in
   * PostgREST. Any HTTP response — including 5xx — and any timeout is
   * surfaced to the caller instead of retried. Among the remaining errors,
   * connection-never-established failures are retryable for every method,
   * ambiguous network errors (ECONNRESET, EPIPE, missing code) only for
   * idempotent methods, and anything else (cancellation, bad config) never —
   * those fail identically on replay. Resets on reused keep-alive sockets
   * are additionally retryable for any method via `isStaleSocketReset`.
   */
  static isRetryableError(error: unknown, method: string): boolean {
    if (!axios.isAxiosError(error) || error.response) {
      return false;
    }
    const code = error.code ?? '';
    if (TIMEOUT_ERROR_CODES.has(code)) {
      return false;
    }
    if (CONNECTION_NOT_ESTABLISHED_CODES.has(code)) {
      return true;
    }
    if (code === '' || AMBIGUOUS_NETWORK_CODES.has(code)) {
      return IDEMPOTENT_METHODS.has(method.toUpperCase());
    }
    return false;
  }

  /**
   * An ECONNRESET on a reused keep-alive socket almost always means the
   * server closed the connection while it sat idle in the pool and the
   * request died before it was processed — Node exposes
   * `request.reusedSocket` for exactly this case and endorses one immediate
   * retry (https://nodejs.org/api/http.html#requestreusedsocket), which is
   * why the replay applies to any method, including writes.
   *
   * This is a strong heuristic, not a proof: a reused socket can also reset
   * after the server committed a write but before the response arrived, and
   * a replay would then duplicate it. That window is kept small by the
   * agents' freeSocketTimeout (idle sockets are reaped client-side before
   * the server closes them) and by capping the replay at one attempt, and
   * non-idempotent replays are logged with a distinct message so duplicates
   * can be traced and alerted on.
   */
  static isStaleSocketReset(error: unknown): boolean {
    if (!axios.isAxiosError(error) || error.response) {
      return false;
    }
    const request = error.request as { reusedSocket?: boolean } | undefined;
    return error.code === 'ECONNRESET' && request?.reusedSocket === true;
  }

  /**
   * Filter headers for forwarding to client (excludes problematic ones)
   */
  static filterHeaders(headers: Record<string, unknown>): Record<string, string> {
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      const normalizedKey = key.toLowerCase();
      if (
        !EXCLUDED_HEADERS.has(normalizedKey) &&
        !normalizedKey.startsWith('access-control-') &&
        value !== undefined
      ) {
        filtered[key] = value as string;
      }
    }
    return filtered;
  }

  async forward(request: ProxyRequest): Promise<ProxyResponse> {
    return this.forwardRequest(request);
  }

  async forwardAsAdmin(request: ProxyRequest): Promise<ProxyResponse> {
    return this.forwardRequest({
      ...request,
      headers: {
        ...request.headers,
        // Project admin subjects are intentionally dropped before PostgREST
        // because auth.uid() is UUID-based while admin subjects are not.
        authorization: `Bearer ${this.adminToken}`,
      },
    });
  }

  /**
   * Gateway exchange for anon-role requests: PostgREST derives its role from
   * a JWT claim, so the client credential (opaque anon key, or a legacy anon
   * JWT carrying the old shared fake subject) is swapped for an internally-
   * minted subject-less `anon` JWT that never leaves the server. All anon
   * traffic therefore reaches the database with identical claims.
   */
  async forwardAsAnon(request: ProxyRequest): Promise<ProxyResponse> {
    return this.forwardRequest({
      ...request,
      headers: {
        ...request.headers,
        authorization: `Bearer ${this.anonToken}`,
      },
    });
  }

  /**
   * Gateway exchange for authenticated users: verify the user's token in the
   * app layer, and swap it for a short-lived internal HS256 token containing the
   * user's claims to forward to PostgREST.
   */
  async forwardAsUser(
    request: ProxyRequest,
    user: { id: string; email?: string; role: string }
  ): Promise<ProxyResponse> {
    if (user.role !== 'authenticated' && user.role !== 'project_admin') {
      throw new AppError('Invalid user role claim', 403, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    const userToken = this.tokenManager.generatePostgrestUserToken({
      sub: user.id,
      email: user.email,
      role: user.role as 'authenticated' | 'project_admin',
    });

    return this.forwardRequest({
      ...request,
      headers: {
        ...request.headers,
        authorization: `Bearer ${userToken}`,
      },
    });
  }

  /**
   * Forward request to PostgREST with retry logic
   */
  private async forwardRequest(request: ProxyRequest): Promise<ProxyResponse> {
    const targetUrl = `${postgrestUrl}${request.path}`;

    const axiosConfig: {
      method: string;
      url: string;
      params?: Record<string, unknown>;
      headers: Record<string, string | string[] | undefined>;
      data?: unknown;
    } = {
      method: request.method,
      url: targetUrl,
      params: request.query,
      headers: {
        ...request.headers,
        host: undefined,
        'content-length': undefined,
      },
    };

    if (request.body !== undefined) {
      axiosConfig.data = request.body;
    }

    // Retry logic
    let response: AxiosResponse | undefined;
    let lastError: unknown;
    const maxRetries = 3;
    // A reset on a reused keep-alive socket gets exactly one immediate
    // replay regardless of method; a second reset falls through to the
    // method-based policy so writes cannot ping-pong on repeated resets.
    let staleSocketRetryUsed = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        response = await postgrestAxios(axiosConfig);
        break;
      } catch (error) {
        lastError = error;
        if (attempt >= maxRetries) {
          throw error;
        }

        const staleSocketRetry =
          !staleSocketRetryUsed && PostgrestProxyService.isStaleSocketReset(error);
        if (staleSocketRetry) {
          staleSocketRetryUsed = true;
        } else if (!PostgrestProxyService.isRetryableError(error, request.method)) {
          throw error;
        }

        // Non-idempotent stale-socket replays get a distinct message so a
        // CloudWatch metric filter can alert on them if duplicate writes are
        // ever suspected (see isStaleSocketReset on why they are replayed).
        const nonIdempotentReplay =
          staleSocketRetry && !IDEMPOTENT_METHODS.has(request.method.toUpperCase());
        logger.warn(
          nonIdempotentReplay
            ? `PostgREST stale-socket replay of non-idempotent request (attempt ${attempt}/${maxRetries})`
            : `PostgREST request failed, retrying (attempt ${attempt}/${maxRetries})`,
          {
            url: targetUrl,
            method: request.method,
            errorCode: (error as NodeJS.ErrnoException).code,
            message: (error as Error).message,
            staleSocketRetry,
          }
        );

        if (!staleSocketRetry) {
          const backoffDelay = Math.min(200 * Math.pow(2.5, attempt - 1), 1000);
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        }
      }
    }

    if (!response) {
      throw lastError || new Error('Failed to get response from PostgREST');
    }

    return {
      data: response.data,
      status: response.status,
      headers: response.headers as Record<string, unknown>,
    };
  }
}
