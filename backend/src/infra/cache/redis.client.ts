import { createClient } from 'redis';
import logger from '@/utils/logger.js';

export type AppRedisClient = ReturnType<typeof createClient>;

export class RedisClientService {
  private static instance: RedisClientService;
  private client: AppRedisClient | null = null;
  private connectPromise: Promise<AppRedisClient | null> | null = null;
  private hasLoggedDisabled = false;

  private constructor() {}

  public static getInstance(): RedisClientService {
    if (!RedisClientService.instance) {
      RedisClientService.instance = new RedisClientService();
    }
    return RedisClientService.instance;
  }

  private getRedisUrl(): string | null {
    const redisUrl = process.env.REDIS_URL?.trim();
    return redisUrl && redisUrl.length > 0 ? redisUrl : null;
  }

  async getClient(): Promise<AppRedisClient | null> {
    const redisUrl = this.getRedisUrl();

    if (!redisUrl) {
      if (!this.hasLoggedDisabled) {
        logger.warn('REDIS_URL not configured, using in-memory rate-limit stores');
        this.hasLoggedDisabled = true;
      }
      return null;
    }

    if (this.client?.isOpen) {
      return this.client;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.connect(redisUrl).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private async connect(redisUrl: string): Promise<AppRedisClient | null> {
    try {
      const client = createClient({ url: redisUrl });

      client.on('error', (error) => {
        logger.error('Redis client error', { error });
      });

      client.on('reconnecting', () => {
        logger.warn('Redis client reconnecting');
      });

      await client.connect();
      this.client = client;
      logger.info('Redis client connected');
      return client;
    } catch (error) {
      logger.error('Failed to connect Redis client, using in-memory rate-limit stores', {
        error,
      });
      this.client = null;
      return null;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      if (this.client.isOpen) {
        await this.client.quit();
      }
    } catch (error) {
      logger.error('Failed to close Redis client cleanly', { error });
    } finally {
      this.client = null;
    }
  }
}
