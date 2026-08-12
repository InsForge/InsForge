import OpenAI from 'openai';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { isCloudEnvironment } from '@/utils/environment.js';
import { AppError, UpstreamError } from '@/utils/errors.js';
import { ERROR_CODES, type AIOverview } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { ModelGatewayConfigService } from '@/services/ai/model-gateway-config.service.js';

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
  byok_usage_inference: number;
  date: string;
  endpoint_id: string;
  model: string;
  model_permaslug: string;
  provider_name: string;
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

interface ModelUsageAccumulator {
  model: string;
  providers: Set<string>;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  spend: number;
  byokSpend: number;
}

export type ApiKeySource = 'cloud' | 'self-hosted';
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
    observabilityError: 'Configure an OpenRouter API key to load Model Gateway usage.',
  },
  charts: {
    spend: [],
    requests: [],
    tokens: [],
  },
  modelUsage: [],
};

function getCaughtErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Unknown error';
}

export class OpenRouterProvider {
  private static instance: OpenRouterProvider;
  private cloudCredentials: CloudCredentials | undefined;
  private openRouterClient: OpenAI | null = null;
  private currentApiKey: string | undefined;
  private fetchPromise: Promise<string> | null = null;
  private rotationPromise: Promise<string> | null = null;
  private modelGatewayConfigService = ModelGatewayConfigService.getInstance();

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
   * Cloud projects use InsForge Cloud-managed credentials; self-hosting prefers the encrypted
   * Model Gateway secret store and falls back to OPENROUTER_API_KEY for upgrade resilience.
   * Use this instead of getApiKey() when downstream logic depends on the source.
   */
  async getApiKeyWithSource(): Promise<ResolvedApiKey> {
    if (isCloudEnvironment()) {
      const apiKey = this.cloudCredentials
        ? this.cloudCredentials.apiKey
        : await this.fetchCloudApiKey();
      return { apiKey, source: 'cloud' };
    }

    // Self-hosted: dashboard-managed encrypted secret.
    const apiKey = await this.modelGatewayConfigService.getApiKey();
    if (!apiKey) {
      throw new AppError(
        'OpenRouter API key not configured. Configure Model Gateway settings or set OPENROUTER_API_KEY.',
        500,
        ERROR_CODES.AI_INVALID_API_KEY
      );
    }
    return { apiKey, source: 'self-hosted' };
  }

  /**
   * Get OpenRouter API key with priority order:
   * 1. InsForge Cloud-managed key (cloud environment only)
   * 2. Model Gateway secret store (self-hosted)
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
    if (this.currentApiKey !== apiKey) {
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

  async rotateManagedApiKey(): Promise<{ apiKey: string; maskedKey: string }> {
    if (!isCloudEnvironment()) {
      throw new AppError(
        'OpenRouter API key rotation is only available for InsForge Cloud-managed keys.',
        400,
        ERROR_CODES.INVALID_INPUT,
        'For self-hosted projects, update the key in Model Gateway settings.'
      );
    }

    const apiKey = await this.rotateCloudApiKey();
    return {
      apiKey,
      maskedKey: this.maskApiKey(apiKey),
    };
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
    const modelUsage = this.buildModelUsage(activity);

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
      modelUsage,
    };
  }

  private async fetchCurrentKeyInfo(apiKey: string): Promise<OpenRouterKeyInfo> {
    const response = await fetch('https://openrouter.ai/api/v1/key', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AppError(
          'Invalid OpenRouter API Key',
          400,
          ERROR_CODES.AI_INVALID_API_KEY,
          'Check your OpenRouter key and try again.'
        );
      }
      if (response.status === 429) {
        throw new AppError(
          'OpenRouter rate limit exceeded. Please wait before retrying.',
          429,
          ERROR_CODES.RATE_LIMITED
        );
      }
      const message = (await response.text()) || response.statusText || 'OpenRouter request failed';
      throw new AppError(message, response.status, ERROR_CODES.AI_UPSTREAM_UNAVAILABLE);
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

    let managementCredential: string | null;
    try {
      managementCredential = await this.modelGatewayConfigService.getManagementKey();
    } catch (error) {
      logger.warn('Unable to load the OpenRouter management credential', {
        error: getCaughtErrorMessage(error),
      });
      return {
        available: false,
        data: [],
        error: 'OpenRouter activity is temporarily unavailable.',
      };
    }

    if (!managementCredential) {
      return {
        available: false,
        data: [],
        error:
          'Configure an OpenRouter management key to load request, token, model, and historical activity.',
      };
    }

    const apiKeyHash = this.resolveActivityApiKeyHash(apiKey, apiKeyHashFromOpenRouter);
    const url = new URL('https://openrouter.ai/api/v1/activity');
    url.searchParams.set('api_key_hash', apiKeyHash);

    let response: Response | undefined;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${managementCredential}` },
      });

      if (response.status === 401 || response.status === 403 || response.status === 404) {
        return {
          available: false,
          data: [],
          error: 'The configured OpenRouter management key cannot access this API key.',
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
      byok_usage_inference: Number(item.byok_usage_inference ?? 0),
      date: String(item.date || ''),
      endpoint_id: String(item.endpoint_id || ''),
      model: String(item.model || ''),
      model_permaslug: String(item.model_permaslug || ''),
      provider_name: String(item.provider_name || ''),
      usage: Number(item.usage || 0),
      requests: Number(item.requests || 0),
      prompt_tokens: Number(item.prompt_tokens || 0),
      completion_tokens: Number(item.completion_tokens || 0),
      reasoning_tokens: Number(item.reasoning_tokens || 0),
    }));
  }

  private buildModelUsage(
    activity: OpenRouterActivityItem[]
  ): NonNullable<AIOverview['modelUsage']> {
    const allowedDays = new Set(this.createOverviewBuckets().keys());
    const models = new Map<string, ModelUsageAccumulator>();

    for (const item of activity) {
      if (!allowedDays.has(this.resolveActivityBucketKey(item.date))) {
        continue;
      }

      const model = item.model || item.model_permaslug || 'Unknown model';
      const current = models.get(model) ?? {
        model,
        providers: new Set<string>(),
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        spend: 0,
        byokSpend: 0,
      };

      if (item.provider_name) {
        current.providers.add(item.provider_name);
      }
      current.requests += item.requests;
      current.promptTokens += item.prompt_tokens;
      current.completionTokens += item.completion_tokens;
      current.reasoningTokens += item.reasoning_tokens;
      current.totalTokens += item.prompt_tokens + item.completion_tokens + item.reasoning_tokens;
      current.spend += item.usage;
      current.byokSpend += item.byok_usage_inference;
      models.set(model, current);
    }

    return Array.from(models.values())
      .map(({ providers, ...item }) => ({
        ...item,
        providers: Array.from(providers).sort((a, b) => a.localeCompare(b)),
      }))
      .sort(
        (a, b) => b.spend - a.spend || b.requests - a.requests || a.model.localeCompare(b.model)
      );
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
      throw new AppError(
        'JWT_SECRET not found in environment variables',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
    return jwt.sign({ projectId }, jwtSecret, { expiresIn: '1h' });
  }

  private applyCloudCredentials(data: CloudCredentialsResponse): string {
    if (!data.openrouter?.api_key) {
      throw new AppError(
        'Invalid cloud credentials response: missing openrouter API key',
        502,
        ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
      );
    }

    this.cloudCredentials = {
      apiKey: data.openrouter.api_key,
      limitRemaining: data.openrouter.limit_remaining,
    };

    return data.openrouter.api_key;
  }

  /**
   * Map a non-ok cloud credentials response to a client-safe AppError.
   * Only statuses whose semantics are meaningful to the caller pass through
   * (trial denial, rotation conflict, rate limit); everything else — notably
   * the cloud's 401 for an invalid project token — becomes a 502 so the
   * dashboard cannot mistake it for the admin's own session expiring (its
   * apiClient retries and logs out on 401). The raw body is logged here and
   * never surfaced to the client; only the cloud's structured JSON `message`
   * field is, length-capped.
   */
  private async cloudCredentialsError(response: Response, action: string): Promise<AppError> {
    const rawBody = await response.text().catch(() => '');
    logger.error(`Failed to ${action} cloud OpenRouter credentials`, {
      status: response.status,
      body: rawBody.slice(0, 2000),
    });

    let upstreamMessage: string | undefined;
    try {
      const parsed = JSON.parse(rawBody) as { message?: unknown };
      if (typeof parsed.message === 'string') {
        upstreamMessage = parsed.message;
      }
    } catch {
      // Non-JSON body — keep it out of the client-facing message.
    }

    const message =
      upstreamMessage?.slice(0, 300) ||
      `Failed to ${action} cloud OpenRouter credentials (upstream status ${response.status})`;

    if (response.status === 429) {
      return new AppError(message, 429, ERROR_CODES.RATE_LIMITED);
    }
    const status = response.status === 403 || response.status === 409 ? response.status : 502;
    return new AppError(message, status, ERROR_CODES.AI_UPSTREAM_UNAVAILABLE);
  }

  /**
   * Fetch API key from cloud service
   * Uses promise memoization to prevent duplicate fetch requests
   */
  private async fetchCloudApiKey(): Promise<string> {
    // A rotation in flight will refresh cloudCredentials with the newest key;
    // fetching concurrently could land a stale pre-rotation key after it.
    if (this.rotationPromise) {
      logger.info('Rotation in progress, waiting for the rotated key...');
      return this.rotationPromise;
    }

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
          throw new AppError(
            'PROJECT_ID not found in environment variables',
            500,
            ERROR_CODES.INTERNAL_ERROR
          );
        }
        const token = this.createCloudProjectToken(projectId);

        // Fetch API key from cloud service with sign token as query parameter
        const response = await fetch(
          `${process.env.CLOUD_API_HOST || 'https://api.insforge.dev'}/ai/v1/credentials/${projectId}?sign=${token}`
        );

        if (!response.ok) {
          throw await this.cloudCredentialsError(response, 'fetch');
        }

        const data = (await response.json()) as CloudCredentialsResponse;

        const apiKey = this.applyCloudCredentials(data);

        logger.info('Successfully fetched cloud API key');

        return apiKey;
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

  private async rotateCloudApiKey(): Promise<string> {
    if (this.rotationPromise) {
      logger.info('Rotation already in progress, waiting for completion...');
      return this.rotationPromise;
    }

    this.rotationPromise = (async () => {
      try {
        // Let an in-flight fetch settle before rotating: its response carries
        // the pre-rotation key, and if it landed after the rotated key it would
        // clobber cloudCredentials with a just-revoked key — which then 401s
        // on every request until a restart.
        if (this.fetchPromise) {
          await this.fetchPromise.catch(() => undefined);
        }

        const projectId = process.env.PROJECT_ID;
        if (!projectId) {
          throw new AppError(
            'PROJECT_ID not found in environment variables',
            500,
            ERROR_CODES.INTERNAL_ERROR
          );
        }
        const token = this.createCloudProjectToken(projectId);

        const response = await fetch(
          `${process.env.CLOUD_API_HOST || 'https://api.insforge.dev'}/ai/v1/credentials/${projectId}/rotate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sign: token }),
          }
        );

        if (!response.ok) {
          throw await this.cloudCredentialsError(response, 'rotate');
        }

        const data = (await response.json()) as CloudCredentialsResponse;
        const apiKey = this.applyCloudCredentials(data);

        logger.info('Successfully rotated cloud OpenRouter API key');

        return apiKey;
      } catch (error) {
        logger.error('Failed to rotate cloud OpenRouter API key', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      } finally {
        this.rotationPromise = null;
      }
    })();

    return this.rotationPromise;
  }

  /**
   * Send a request to OpenRouter and convert upstream errors to actionable responses.
   * Cloud-managed keys are minted unlimited for paid orgs and hard-capped for free
   * orgs, so a 402 means the plan's AI credit is exhausted — there is no renewal
   * to attempt (the legacy /renew top-up flow only serves old project images).
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
      // Convert upstream API errors to actionable responses
      if (error instanceof OpenAI.APIError) {
        if (error.status === 402) {
          throw new AppError(
            'AI credit limit reached.',
            402,
            ERROR_CODES.BILLING_INSUFFICIENT_BALANCE,
            source === 'cloud'
              ? 'This project has used all of its AI credits. Upgrade your plan to continue using AI.'
              : 'Add credits to your OpenRouter account.'
          );
        }
        if (error.status === 401 || error.status === 403) {
          throw new AppError(
            'AI provider authentication failed. Check your API key configuration.',
            401,
            ERROR_CODES.AI_INVALID_API_KEY,
            source === 'cloud'
              ? 'Check the cloud-managed OpenRouter credential.'
              : 'Set a valid OPENROUTER_API_KEY or update Model Gateway settings.'
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
        throw new UpstreamError(
          error,
          'AI provider request failed.',
          ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
        );
      }

      throw new UpstreamError(
        error,
        'AI provider request failed.',
        ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
      );
    }
  }
}
