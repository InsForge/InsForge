import axios, { AxiosResponse } from 'axios';
import http from 'http';
import https from 'https';
import { TokenManager } from '@/infra/security/token.manager.js';
import logger from '@/utils/logger.js';
import { appConfig } from '@/infra/config/app.config.js';

const postgrestUrl = appConfig.database.postgrestBaseUrl;

// Connection pooling for PostgREST
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 5000,
  maxSockets: 20,
  maxFreeSockets: 5,
  timeout: 10000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 5000,
  maxSockets: 20,
  maxFreeSockets: 5,
  timeout: 10000,
});

const postgrestAxios = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 10000,
  maxRedirects: 0,
  headers: {
    Connection: 'keep-alive',
    'Keep-Alive': 'timeout=5, max=10',
  },
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
    const userToken = this.tokenManager.generatePostgrestUserToken({
      sub: user.id,
      email: user.email,
      role: user.role as any,
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

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        response = await postgrestAxios(axiosConfig);
        break;
      } catch (error) {
        lastError = error;
        const shouldRetry = axios.isAxiosError(error) && !error.response && attempt < maxRetries;

        if (shouldRetry) {
          logger.warn(`PostgREST request failed, retrying (attempt ${attempt}/${maxRetries})`, {
            url: targetUrl,
            errorCode: (error as NodeJS.ErrnoException).code,
            message: (error as Error).message,
          });
          const backoffDelay = Math.min(200 * Math.pow(2.5, attempt - 1), 1000);
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        } else {
          throw error;
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
