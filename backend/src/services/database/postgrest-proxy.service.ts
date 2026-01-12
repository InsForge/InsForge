import axios, { AxiosResponse } from 'axios';
import http from 'http';
import https from 'https';
import { TokenManager } from '@/infra/security/token.manager.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import logger from '@/utils/logger.js';

const postgrestUrl = process.env.POSTGREST_BASE_URL || 'http://localhost:5430';

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
  apiKey?: string;
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
  private secretService = SecretService.getInstance();
  private adminToken: string;

  private constructor() {
    this.adminToken = this.tokenManager.generateAdminToken();
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
      if (!EXCLUDED_HEADERS.has(key.toLowerCase()) && value !== undefined) {
        filtered[key] = value as string;
      }
    }
    return filtered;
  }

  /**
   * Forward request to PostgREST with retry logic
   */
  async forward(request: ProxyRequest): Promise<ProxyResponse> {
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

    // Use admin token if valid API key provided
    if (request.apiKey) {
      const isValid = await this.secretService.verifyApiKey(request.apiKey);
      if (isValid) {
        axiosConfig.headers.authorization = `Bearer ${this.adminToken}`;
      }
    }

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
