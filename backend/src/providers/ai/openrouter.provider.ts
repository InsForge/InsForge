import OpenAI from 'openai';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { isCloudEnvironment } from '@/utils/environment.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { AIOverview } from '@insforge/shared-schemas';

interface CloudCredentialsResponse {
  openrouter?: {
    api_key: string;
    limit?: number;
    expired_at?: string | null;
    usage?: number;
    limit_remaining?: number;
  };
}

interface CloudCredentials {
  apiKey: string;
  limitRemaining?: number;
}

interface OpenRouterKeyInfo {
  data: {
    hash?: string;
    label: string;
    usage: number;
    usage_daily?: number;
    usage_weekly?: number;
    usage_monthly?: number;
    limit: number | null;
    limit_remaining?: number | null;
    limit_reset?: string | null;
    is_free_tier: boolean;
    is_management_key?: boolean;
  };
}

interface OpenRouterActivityItem {
  date: string;
  usage: number;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
}

interface OverviewBucket {
  label: string;
  usage: number;
  requests: number;
  tokens: number;
}

export type ApiKeySource = 'cloud' | 'env';
interface ResolvedApiKey {
  apiKey: string;
  source: ApiKeySource;
}

const EMPTY_AI_OVERVIEW: AIOverview = {
  key: {
    limit: null,
    limitRemaining: null,
    limitReset: null,
    usage: 0,
    usageDaily: 0,
    usageWeekly: 0,
    usageMonthly: 0,
    observabilityAvailable: false,
  },
  charts: {
    spend: [],
    requests: [],
    tokens: [],
  },
};

function getCaughtErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown error';
}

export class OpenRouterProvider {
  private static instance: OpenRouterProvider;
  private cloudCredentials: CloudCredentials | undefined;
  private openRouterClient: OpenAI | null = null;
  private currentApiKey: string | undefined;
  private renewalPromise: Promise<string> | null = null;
  private fetchPromise: Promise<string> | null = null;

  private constructor() {}

  static getInstance(): OpenRouterProvider {
    if (!OpenRouterProvider.instance) {
      OpenRouterProvider.instance = new OpenRouterProvider();
    }
    return OpenRouterProvider.instance;
  }

  /**
   * Create or recreate the OpenAI client with the given API key
   */
  private createClient(apiKey: string): OpenAI {
    this.currentApiKey = apiKey;
    return new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://insforge.dev',
        'X-Title': 'InsForge',
      },
    });
  }

  /**
   * Resolve the API key and its source in one call.
   * Cloud projects use InsForge Cloud-managed credentials; self-hosting uses OPENROUTER_API_KEY.
   * Use this instead of getApiKey() when downstream logic depends on the source.
   */
  async getApiKeyWithSource(): Promise<ResolvedApiKey> {
    if (isCloudEnvironment()) {
      const apiKey = this.cloudCredentials
        ? this.cloudCredentials.apiKey
        : await this.fetchCloudApiKey();
      return { apiKey, source: 'cloud' };
    }

    // 3. Self-hosted: env variable fallback
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new AppError(
        'OpenRouter API key not configured. Set OPENROUTER_API_KEY in the backend environment.',
        500,
        ERROR_CODES.AI_INVALID_API_KEY
      );
    }
    return { apiKey, source: 'env' };
  }

  /**
   * Get OpenRouter API key with priority order:
   * 1. InsForge Cloud-managed key (cloud environment only)
   * 2. OPENROUTER_API_KEY environment variable (self-hosted)
   */
  async getApiKey(): Promise<string> {
    return (await this.getApiKeyWithSource()).apiKey;
  }

  async getMaskedApiKey(): Promise<{ apiKey: string; maskedKey: string }> {
    const apiKey = await this.getApiKey();
    return {
      apiKey,
      maskedKey: this.maskApiKey(apiKey),
    };
  }

  /**
   * Get the OpenAI client, creating or updating it as needed.
   * Accepts a pre-resolved apiKey to avoid a redundant getApiKeyWithSource() call.
   */
  private async getClient(resolvedApiKey?: string): Promise<OpenAI> {
    const apiKey = resolvedApiKey ?? (await this.getApiKey());
    if (!this.openRouterClient) {
      this.openRouterClient = this.createClient(apiKey);
      return this.openRouterClient;
    }
    if (isCloudEnvironment() && this.currentApiKey !== apiKey) {
      this.openRouterClient = this.createClient(apiKey);
    }
    return this.openRouterClient;
  }

  private maskApiKey(apiKey: string): string {
    if (apiKey.length <= 12) {
      return '••••••••';
    }
    return `${apiKey.slice(0, 8)}••••••••${apiKey.slice(-4)}`;
  }

  isConfigured(): boolean {
    if (isCloudEnvironment()) {
      return true;
    }
    return !!process.env.OPENROUTER_API_KEY;
  }

  /**
   * Fetch OpenRouter key usage and activity for the active gateway key.
   * /activity requires a management key; when unavailable, return key-level usage only.
   */
  async getOverview(): Promise<AIOverview> {
    let resolved: ResolvedApiKey;
    try {
      resolved = await this.getApiKeyWithSource();
    } catch (error) {
      if (error instanceof AppError && error.code === ERROR_CODES.AI_INVALID_API_KEY) {
        return EMPTY_AI_OVERVIEW;
      }
      throw error;
    }

    const keyInfo = await this.fetchCurrentKeyInfo(resolved.apiKey);
    const activityResult = await this.fetchActivity(
      resolved.apiKey,
      keyInfo.data.hash,
      resolved.source
    );
    const activity = activityResult.data;
    const charts = this.buildOverviewCharts(activity);

    return {
      key: {
        label: keyInfo.data.label,
        limit: keyInfo.data.limit,
        limitRemaining:
          keyInfo.data.limit_remaining ??
          (keyInfo.data.limit !== null ? keyInfo.data.limit - keyInfo.data.usage : null),
        limitReset: keyInfo.data.limit_reset ?? null,
        usage: keyInfo.data.usage ?? 0,
        usageDaily: keyInfo.data.usage_daily ?? 0,
        usageWeekly: keyInfo.data.usage_weekly ?? 0,
        usageMonthly: keyInfo.data.usage_monthly ?? 0,
        isFreeTier: keyInfo.data.is_free_tier,
        observabilityAvailable: activityResult.available,
        observabilityError: activityResult.error,
      },
      charts,
    };
  }

  private async fetchCurrentKeyInfo(apiKey: string): Promise<OpenRouterKeyInfo> {
    const response = await fetch('https://openrouter.ai/api/v1/key', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new AppError(
        'Invalid OpenRouter API Key',
        500,
        ERROR_CODES.AI_INVALID_API_KEY,
        'Check your OpenRouter key and try again.'
      );
    }

    return (await response.json()) as OpenRouterKeyInfo;
  }

  private async fetchActivity(
    apiKey: string,
    apiKeyHashFromOpenRouter: string | undefined,
    source: ApiKeySource
  ): Promise<{ available: boolean; data: OpenRouterActivityItem[]; error?: string }> {
    if (source === 'cloud') {
      return this.fetchCloudActivity();
    }

    const apiKeyHash = this.resolveActivityApiKeyHash(apiKey, apiKeyHashFromOpenRouter);
    const url = new URL('https://openrouter.ai/api/v1/activity');
    url.searchParams.set('api_key_hash', apiKeyHash);

    let response: Response | undefined;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (response.status === 401 || response.status === 403 || response.status === 404) {
        return {
          available: false,
          data: [],
          error: 'Activity requires an OpenRouter management key with access to this API key hash.',
        };
      }

      if (!response.ok) {
        logger.warn('OpenRouter activity request failed', {
          status: response.status,
          statusText: response.statusText,
        });
        return {
          available: false,
          data: [],
          error: 'OpenRouter activity is temporarily unavailable.',
        };
      }

      const payload = (await response.json()) as { data?: Partial<OpenRouterActivityItem>[] };
      return { available: true, data: this.normalizeActivity(payload.data ?? []) };
    } catch (error) {
      const errorMessage = getCaughtErrorMessage(error);
      logger.warn('OpenRouter activity request failed', {
        status: response?.status,
        statusText: response?.statusText,
        error: errorMessage,
      });
      return {
        available: false,
        data: [],
        error: 'OpenRouter activity is temporarily unavailable.',
      };
    }
  }

  private async fetchCloudActivity(): Promise<{
    available: boolean;
    data: OpenRouterActivityItem[];
    error?: string;
  }> {
    const projectId = process.env.PROJECT_ID;
    if (!projectId) {
      return {
        available: false,
        data: [],
        error: 'PROJECT_ID is not configured for cloud activity lookup.',
      };
    }

    let token: string;
    try {
      token = this.createCloudProjectToken(projectId);
    } catch (error) {
      return {
        available: false,
        data: [],
        error: error instanceof Error ? error.message : 'Unable to sign cloud activity request.',
      };
    }

    const url = new URL(
      `${process.env.CLOUD_API_HOST || 'https://api.insforge.dev'}/ai/v1/activity/${projectId}`
    );
    url.searchParams.set('sign', token);

    let response: Response | undefined;
    try {
      response = await fetch(url, { method: 'GET' });
      if (!response.ok) {
        logger.warn('Cloud OpenRouter activity request failed', {
          status: response.status,
          statusText: response.statusText,
        });
        return {
          available: false,
          data: [],
          error: 'Cloud OpenRouter activity is temporarily unavailable.',
        };
      }

      const payload = (await response.json()) as { data?: Partial<OpenRouterActivityItem>[] };
      return { available: true, data: this.normalizeActivity(payload.data ?? []) };
    } catch (error) {
      const errorMessage = getCaughtErrorMessage(error);
      logger.warn('Cloud OpenRouter activity request failed', {
        status: response?.status,
        statusText: response?.statusText,
        error: errorMessage,
      });
      return {
        available: false,
        data: [],
        error: 'Cloud OpenRouter activity is temporarily unavailable.',
      };
    }
  }

  private resolveActivityApiKeyHash(apiKey: string, apiKeyHashFromOpenRouter?: string): string {
    const documentedHash = apiKeyHashFromOpenRouter?.match(/[a-f0-9]{64}$/i)?.[0];
    return documentedHash ?? createHash('sha256').update(apiKey).digest('hex');
  }

  private normalizeActivity(items: Partial<OpenRouterActivityItem>[]): OpenRouterActivityItem[] {
    return items.map((item) => ({
      date: String(item.date || ''),
      usage: Number(item.usage || 0),
      requests: Number(item.requests || 0),
      prompt_tokens: Number(item.prompt_tokens || 0),
      completion_tokens: Number(item.completion_tokens || 0),
      reasoning_tokens: Number(item.reasoning_tokens || 0),
    }));
  }

  private buildOverviewCharts(activity: OpenRouterActivityItem[]): AIOverview['charts'] {
    const allowedBuckets = this.createOverviewBuckets();
    const buckets = new Map<string, OverviewBucket>(
      Array.from(allowedBuckets.entries()).map(([key, bucket]) => [key, { ...bucket }])
    );

    for (const item of activity) {
      const bucketKey = this.resolveActivityBucketKey(item.date);
      const bucket = buckets.get(bucketKey);
      if (!bucket) {
        continue;
      }

      bucket.usage += item.usage ?? 0;
      bucket.requests += item.requests ?? 0;
      bucket.tokens +=
        (item.prompt_tokens ?? 0) + (item.completion_tokens ?? 0) + (item.reasoning_tokens ?? 0);
    }

    const entries = this.sortOverviewBuckets(Array.from(buckets.values()), allowedBuckets);

    return {
      spend: entries.map((bucket) => ({ label: bucket.label, value: bucket.usage })),
      requests: entries.map((bucket) => ({ label: bucket.label, value: bucket.requests })),
      tokens: entries.map((bucket) => ({ label: bucket.label, value: bucket.tokens })),
    };
  }

  private sortOverviewBuckets(
    entries: OverviewBucket[],
    allowedBuckets: Map<string, OverviewBucket>
  ): OverviewBucket[] {
    const bucketOrder = new Map(
      Array.from(allowedBuckets.keys()).map((key, index) => [key, index])
    );
    return [...entries].sort(
      (a, b) =>
        (bucketOrder.get(a.label) ?? Number.MAX_SAFE_INTEGER) -
        (bucketOrder.get(b.label) ?? Number.MAX_SAFE_INTEGER)
    );
  }

  private createOverviewBuckets(): Map<string, OverviewBucket> {
    const buckets = new Map<string, OverviewBucket>();
    const dayCount = 30;
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - (dayCount - 1));
    for (let index = 0; index < dayCount; index++) {
      const bucketDate = new Date(start.getTime() + index * 24 * 60 * 60 * 1000);
      const key = this.formatUtcDayBucket(bucketDate);
      buckets.set(key, { label: key, usage: 0, requests: 0, tokens: 0 });
    }
    return buckets;
  }

  private resolveActivityBucketKey(date: string): string {
    return date.slice(0, 10);
  }

  private formatUtcDayBucket(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private createCloudProjectToken(projectId: string): string {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET not found in environment variables');
    }
    return jwt.sign({ projectId }, jwtSecret, { expiresIn: '1h' });
  }

  /**
   * Fetch API key from cloud service
   * Uses promise memoization to prevent duplicate fetch requests
   */
  private async fetchCloudApiKey(): Promise<string> {
    // If fetch is already in progress, wait for it
    if (this.fetchPromise) {
      logger.info('Fetch already in progress, waiting for completion...');
      return this.fetchPromise;
    }

    // Start new fetch and store the promise
    this.fetchPromise = (async () => {
      try {
        const projectId = process.env.PROJECT_ID;
        if (!projectId) {
          throw new Error('PROJECT_ID not found in environment variables');
        }
        const token = this.createCloudProjectToken(projectId);

        // Fetch API key from cloud service with sign token as query parameter
        const response = await fetch(
          `${process.env.CLOUD_API_HOST || 'https://api.insforge.dev'}/ai/v1/credentials/${projectId}?sign=${token}`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch cloud API key: ${response.statusText}`);
        }

        const data = (await response.json()) as CloudCredentialsResponse;

        // Extract API key from the openrouter object in response
        if (!data.openrouter?.api_key) {
          throw new Error('Invalid response: missing openrouter API Key');
        }

        // Store credentials with metadata
        this.cloudCredentials = {
          apiKey: data.openrouter.api_key,
          limitRemaining: data.openrouter.limit_remaining,
        };

        logger.info('Successfully fetched cloud API key');

        return data.openrouter.api_key;
      } catch (error) {
        logger.error('Failed to fetch cloud API key', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      } finally {
        // Clear the promise after completion (success or failure)
        this.fetchPromise = null;
      }
    })();

    return this.fetchPromise;
  }

  /**
   * Renew API key from cloud service when credits are exhausted
   * Uses promise memoization to prevent duplicate renewal requests
   */
  async renewCloudApiKey(): Promise<string> {
    // If renewal is already in progress, wait for it
    if (this.renewalPromise) {
      logger.info('Renewal already in progress, waiting for completion...');
      return this.renewalPromise;
    }

    // Start new renewal and store the promise
    this.renewalPromise = (async () => {
      try {
        const projectId = process.env.PROJECT_ID;
        if (!projectId) {
          throw new Error('PROJECT_ID not found in environment variables');
        }
        const token = this.createCloudProjectToken(projectId);

        // Renew API key from cloud service with sign token in request body
        const response = await fetch(
          `${process.env.CLOUD_API_HOST || 'https://api.insforge.dev'}/ai/v1/credentials/${projectId}/renew`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sign: token }),
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to renew cloud API key: ${response.statusText}`);
        }

        const data = (await response.json()) as CloudCredentialsResponse;

        // Extract API key from the openrouter object in response
        if (!data.openrouter?.api_key) {
          throw new Error('Invalid response: missing openrouter API Key');
        }

        // Store credentials with metadata
        this.cloudCredentials = {
          apiKey: data.openrouter.api_key,
          limitRemaining: data.openrouter.limit_remaining,
        };

        logger.info('Successfully renewed cloud API key');

        // Wait for OpenRouter to propagate the updated credits
        await new Promise((resolve) => setTimeout(resolve, 1000));

        return data.openrouter.api_key;
      } catch (error) {
        logger.error('Failed to renew cloud API key', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      } finally {
        // Clear the promise after completion (success or failure)
        this.renewalPromise = null;
      }
    })();

    return this.renewalPromise;
  }

  /**
   * Send a request to OpenRouter with automatic renewal and retry logic
   * Handles 403 insufficient credits errors by renewing the API key and retrying
   * @param request - Function that takes an OpenAI client and returns a Promise
   * @returns The result of the request
   */
  async sendRequest<T>(
    request: (client: OpenAI) => Promise<T>
  ): Promise<{ result: T; source: ApiKeySource }> {
    // Resolve once — thread apiKey into getClient() to avoid a second resolution.
    const { apiKey, source } = await this.getApiKeyWithSource();
    const client = await this.getClient(apiKey);

    try {
      return { result: await request(client), source };
    } catch (error) {
      // Only renew cloud-managed keys on 402/403; self-hosted env keys are never renewed.
      if (
        source === 'cloud' &&
        error instanceof OpenAI.APIError &&
        (error.status === 402 || error.status === 403)
      ) {
        logger.info(`Received ${error.status} insufficient credits, renewing API key...`);
        const renewedApiKey = await this.renewCloudApiKey();

        // Get fresh client with the renewed key — pass it directly to avoid re-resolution
        const renewedClient = await this.getClient(renewedApiKey);

        // Retry with exponential backoff (3 attempts)
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const backoffMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            logger.info(
              `Retrying request after renewal (attempt ${attempt}/${maxRetries}), waiting ${backoffMs}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));

            const result = await request(renewedClient);
            logger.info('Request succeeded after API key renewal');
            return { result, source };
          } catch (retryError) {
            if (attempt === maxRetries) {
              logger.error(`All ${maxRetries} retry attempts failed after API key renewal`);
              throw retryError;
            }
          }
        }
      }

      // Convert upstream API errors to actionable responses
      if (error instanceof OpenAI.APIError) {
        if (error.status === 401 || error.status === 403) {
          throw new AppError(
            'AI provider authentication failed. Check your API key configuration.',
            401,
            ERROR_CODES.AI_INVALID_API_KEY,
            source === 'cloud'
              ? 'Check the cloud-managed OpenRouter credential.'
              : 'Set a valid OPENROUTER_API_KEY in the backend environment.'
          );
        }
        if (error.status === 429) {
          throw new AppError(
            'AI provider rate limit exceeded. Please wait before retrying.',
            429,
            ERROR_CODES.RATE_LIMITED,
            'Wait a moment and retry, or check your API key rate limits.'
          );
        }
      }

      throw error;
    }
  }
}
