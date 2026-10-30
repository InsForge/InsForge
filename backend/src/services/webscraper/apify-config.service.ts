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

  // The encrypted secret store is the only source of truth for self-hosted
  // deployments — there is no environment-variable fallback. Secret-store
  // failures propagate deliberately so an outage is surfaced as an error
  // instead of being silently reported as "not configured".
  async getToken(): Promise<string | null> {
    return this.getStoredToken();
  }

  // createdAt is the connection's age, taken from the secret row. getToken()
  // only ever returns a value read from the secret store, so a non-null token
  // implies a matching row — except for a narrow cross-instance race: this
  // instance's 60s cache can still hold a token that another instance just
  // deleted. Treat that as "no record" rather than fabricating a createdAt;
  // the cache clears within the TTL and the next read is consistent again.
  async getTokenRecord(): Promise<ApifyTokenRecord | null> {
    const token = await this.getToken();
    if (!token) {
      return null;
    }
    const secret = await this.findSecret();
    if (!secret) {
      return null;
    }
    return { token, createdAt: secret.createdAt };
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
        // expiresAt: null because taking over an existing row must clear any
        // expiry it carried. Leave a stale expires_at in place and
        // getSecretByKey() stops matching the row it just wrote, so getConfig()
        // reports `configured: false` immediately after a successful PUT.
        const updated = await this.secretService.updateSecret(secret.id, {
          value,
          isActive: true,
          isReserved: true,
          expiresAt: null,
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

  // The token is stored with isReserved: true, which does not hide it from the
  // Secrets UI (listSecrets() returns reserved rows like any other) — it makes
  // the row un-editable and un-deletable through the generic secrets routes
  // (403 "Cannot update/delete reserved secret"). It also puts it out of reach
  // of the default deleteSecretByKey(), whose statement filters on
  // `is_reserved = false`. Disconnect must use the explicit reserved-capable
  // path, or it removes nothing and still answers 204.
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

  // listSecrets() filters nothing, so it also returns soft-deleted rows.
  // getSecretByKey() — the read path getToken() uses — only matches
  // `is_active = true`, so an inactive row here would pair a live token with a
  // dead row's createdAt in getTokenRecord(). Expiry is deliberately *not*
  // filtered: an expired-but-active row is still the row setToken() must take
  // over, and it clears the stale expires_at when it does.
  private async findSecret(): Promise<{ id: string; createdAt: string } | undefined> {
    const secrets = await this.secretService.listSecrets();
    return secrets.find((secret) => secret.key === APIFY_API_TOKEN_SECRET && secret.isActive);
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
