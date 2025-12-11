import OpenAI from 'openai';
import jwt from 'jsonwebtoken';
import { isCloudEnvironment } from '@/utils/environment.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';

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
    label: string;
    usage: number;
    limit: number | null;
    is_free_tier: boolean;
  };
}

interface OpenRouterLimitation {
  label: string;
  credit_limit: number | null;
  credit_used: number;
  credit_remaining: number | null;
  rate_limit?: {
    requests?: number;
    interval?: string;
    note?: string;
  };
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
   * Get OpenRouter API key based on environment
   * In cloud environment: fetches from cloud API with JWT authentication
   * In local environment: returns from environment variable
   */
  async getApiKey(): Promise<string> {
    if (isCloudEnvironment()) {
      if (this.cloudCredentials) {
        return this.cloudCredentials.apiKey;
      } else {
        return await this.fetchCloudApiKey();
      }
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new AppError(
        'OPENROUTER_API_KEY not found in environment variables',
        500,
        ERROR_CODES.AI_INVALID_API_KEY
      );
    }
    return apiKey;
  }

  /**
   * Get the OpenAI client, creating or updating it as needed
   * Used internally by sendRequest()
   */
  private async getClient(): Promise<OpenAI> {
    if (!this.openRouterClient) {
      this.openRouterClient = this.createClient(await this.getApiKey());
      return this.openRouterClient;
    }
    if (isCloudEnvironment()) {
      const apiKey = await this.getApiKey();
      if (this.currentApiKey !== apiKey) {
        this.openRouterClient = this.createClient(apiKey);
      }
    }
    return this.openRouterClient;
  }

  /**
   * Check if AI services are properly configured
   */
  isConfigured(): boolean {
    if (isCloudEnvironment()) {
      return true;
    }
    return !!process.env.OPENROUTER_API_KEY;
  }

  /**
   * Get remaining credits for the current API key from OpenRouter
   */
  async getRemainingCredits(): Promise<{
    usage: number;
    limit: number | null;
    remaining: number | null;
  }> {
    try {
      const apiKey = await this.getApiKey();

      if (isCloudEnvironment()) {
        // Use InsForge API for cloud environment
        const response = await fetch(
          `https://api.insforge.dev/ai/v1/limitations?credential=${encodeURIComponent(apiKey)}`,
          {
            method: 'GET',
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch key info: ${response.statusText}`);
        }

        const result = (await response.json()) as { data: OpenRouterLimitation };
        const keyInfo = result.data;

        return {
          usage: keyInfo.credit_used,
          limit: keyInfo.credit_limit,
          remaining: keyInfo.credit_remaining,
        };
      } else {
        // Use OpenRouter API for local environment
        const response = await fetch('https://openrouter.ai/api/v1/key', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (!response.ok) {
          throw new AppError(
            `Invalid OpenRouter API Key`,
            500,
            ERROR_CODES.AI_INVALID_API_KEY,
            'Check your OpenRouter key and try again.'
          );
        }

        const keyInfo = (await response.json()) as OpenRouterKeyInfo;

        return {
          usage: keyInfo.data.usage,
          limit: keyInfo.data.limit,
          remaining: keyInfo.data.limit !== null ? keyInfo.data.limit - keyInfo.data.usage : null,
        };
      }
    } catch (error) {
      console.error('Failed to fetch remaining credits:', error);
      throw error;
    }
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

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
          throw new Error('JWT_SECRET not found in environment variables');
        }

        // Sign a token for authentication
        const token = jwt.sign({ projectId }, jwtSecret, { expiresIn: '1h' });

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
        console.error('Failed to fetch cloud API key:', error);
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

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
          throw new Error('JWT_SECRET not found in environment variables');
        }

        // Sign a token for authentication
        const token = jwt.sign({ projectId }, jwtSecret, { expiresIn: '1h' });

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
        console.error('Failed to renew cloud API key:', error);
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
  async sendRequest<T>(request: (client: OpenAI) => Promise<T>): Promise<T> {
    const client = await this.getClient();

    try {
      return await request(client);
    } catch (error) {
      // Check if error is a 402/403 insufficient credits error in cloud environment
      if (
        isCloudEnvironment() &&
        error instanceof OpenAI.APIError &&
        (error.status === 402 || error.status === 403)
      ) {
        logger.info(`Received ${error.status} insufficient credits, renewing API key...`);
        await this.renewCloudApiKey();

        // Retry with exponential backoff (3 attempts)
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const backoffMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
            logger.info(
              `Retrying request after renewal (attempt ${attempt}/${maxRetries}), waiting ${backoffMs}ms...`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));

            const result = await request(client);
            logger.info('Request succeeded after API key renewal');
            return result;
          } catch (retryError) {
            if (attempt === maxRetries) {
              logger.error(`All ${maxRetries} retry attempts failed after API key renewal`);
              throw retryError;
            }
          }
        }
      }
      throw error;
    }
  }
}
