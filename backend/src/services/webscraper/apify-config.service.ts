import type { ApifyConfig } from '@insforge/shared-schemas';
import { SecretService } from '@/services/secrets/secret.service.js';
import logger from '@/utils/logger.js';

export const APIFY_API_TOKEN_SECRET = 'APIFY_API_TOKEN';
const TOKEN_CACHE_TTL_MS = 60 * 1000;

type SecretStore = Pick<
  SecretService,
  'createSecret' | 'getSecretByKey' | 'listSecrets' | 'updateSecret' | 'deleteReservedSecretByKey'
>;

export interface ApifyTokenRecord {
  token: string;
  createdAt: string;
}

export class ApifyConfigService {
  private static instance: ApifyConfigService;
  private cached: { value: string | null; expiresAt: number } | null = null;
  private cacheEpoch = 0;

  constructor(private readonly secretService: SecretStore = SecretService.getInstance()) {}

  static getInstance(): ApifyConfigService {
    if (!ApifyConfigService.instance) {
      ApifyConfigService.instance = new ApifyConfigService();
    }
    return ApifyConfigService.instance;
  }

  // Stored secret wins; the env var is a bootstrap for docker-compose deployments
  // that ship a token without any UI interaction. Secret-store failures propagate
  // deliberately so an outage cannot silently revive the env token.
  async getToken(): Promise<string | null> {
    const stored = await this.getStoredToken();
    return stored ?? this.normalize(process.env.APIFY_API_TOKEN);
  }

  // createdAt is the connection's age. For an env-provided token there is no secret
  // row, so the connection has existed since the process started.
  async getTokenRecord(): Promise<ApifyTokenRecord | null> {
    const token = await this.getToken();
    if (!token) {
      return null;
    }
    const secret = await this.findSecret();
    return {
      token,
      createdAt: secret?.createdAt ?? new Date(Date.now() - process.uptime() * 1000).toISOString(),
    };
  }

  async getConfig(): Promise<ApifyConfig> {
    const token = await this.getToken();
    return {
      token: {
        configured: token !== null,
        maskedKey: token ? this.mask(token) : null,
      },
    };
  }

  async setToken(token: string): Promise<ApifyConfig> {
    const value = token.trim();
    try {
      const secret = await this.findSecret();
      if (secret) {
        const updated = await this.secretService.updateSecret(secret.id, {
          value,
          isActive: true,
          isReserved: true,
        });
        if (!updated) {
          throw new Error(`Failed to update ${APIFY_API_TOKEN_SECRET}`);
        }
      } else {
        await this.secretService.createSecret({
          key: APIFY_API_TOKEN_SECRET,
          value,
          isReserved: true,
        });
      }
    } finally {
      this.invalidate();
    }
    return this.getConfig();
  }

  // The token is stored with isReserved: true, which hides it from the Secrets
  // UI — and also puts it out of reach of the default deleteSecretByKey(), whose
  // statement filters on `is_reserved = false`. Disconnect must use the explicit
  // reserved-capable path, or it removes nothing and still answers 204.
  async deleteToken(): Promise<void> {
    try {
      const removed = await this.secretService.deleteReservedSecretByKey(APIFY_API_TOKEN_SECRET);
      // Zero rows deleted with nothing left behind just means there was nothing
      // to delete — disconnect stays idempotent. Zero rows with the secret still
      // present is a real failure and must not be reported as a disconnect.
      if (!removed && (await this.findSecret())) {
        throw new Error(`Failed to delete ${APIFY_API_TOKEN_SECRET}`);
      }
    } finally {
      this.invalidate();
    }
  }

  private async findSecret(): Promise<{ id: string; createdAt: string } | undefined> {
    const secrets = await this.secretService.listSecrets();
    return secrets.find((secret) => secret.key === APIFY_API_TOKEN_SECRET);
  }

  private invalidate(): void {
    this.cacheEpoch += 1;
    this.cached = null;
  }

  private async getStoredToken(): Promise<string | null> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.value;
    }
    const epoch = this.cacheEpoch;
    try {
      const value = this.normalize(await this.secretService.getSecretByKey(APIFY_API_TOKEN_SECRET));
      // A write invalidated the cache while this read was in flight, so the value is
      // already stale. Return it to this caller but do not cache it over the newer one.
      if (epoch === this.cacheEpoch) {
        this.cached = { value, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS };
      }
      return value;
    } catch (error) {
      logger.warn('Unable to load the Apify API token', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private normalize(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private mask(value: string): string {
    if (value.length <= 12) {
      return '••••••••';
    }
    return `${value.slice(0, 8)}••••••••${value.slice(-4)}`;
  }
}
