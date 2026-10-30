import { ERROR_CODES, type PosthogConfig } from '@insforge/shared-schemas';
import { SecretService } from '@/services/secrets/secret.service.js';
import logger from '@/utils/logger.js';

export const POSTHOG_CONNECTION_SECRET = 'POSTHOG_CONNECTION';
const CACHE_TTL_MS = 60 * 1000;
const PG_UNIQUE_VIOLATION = '23505';

// createSecret() translates Postgres 23505 into an AppError carrying
// SECRET_ALREADY_EXISTS before it reaches callers, so both spellings of the
// duplicate-key case are matched here.
function isDuplicateSecret(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === PG_UNIQUE_VIOLATION || code === ERROR_CODES.SECRET_ALREADY_EXISTS;
}

type SecretStore = Pick<
  SecretService,
  'createSecret' | 'getSecretByKey' | 'listSecrets' | 'updateSecret' | 'deleteReservedSecretByKey'
>;

// `personalApiKey` (phx_) is the only sensitive member; `apiKey` (phc_) is
// PostHog's public ingestion key. One row, not two, so connect/disconnect stay
// atomic — two rows can drift into a half-connected state.
export interface StoredPosthogConnection {
  personalApiKey: string;
  host: string;
  posthogProjectId: string;
  /** phc_ — public ingestion key, discovered from PostHog, not user-supplied. */
  apiKey: string;
  organizationName: string | null;
  projectName: string;
  createdAt: string;
}

export class PostHogConfigService {
  private static instance: PostHogConfigService;
  private cached: { value: StoredPosthogConnection | null; expiresAt: number } | null = null;
  private cacheEpoch = 0;

  constructor(private readonly secretService: SecretStore = SecretService.getInstance()) {}

  static getInstance(): PostHogConfigService {
    if (!PostHogConfigService.instance) {
      PostHogConfigService.instance = new PostHogConfigService();
    }
    return PostHogConfigService.instance;
  }

  // The encrypted secret store is the only source of truth for self-hosted
  // deployments — there is no environment-variable fallback. Store failures
  // propagate deliberately so an outage surfaces as an error rather than being
  // reported as "not connected".
  async getConnection(): Promise<StoredPosthogConnection | null> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.value;
    }
    const epoch = this.cacheEpoch;
    try {
      const raw = await this.secretService.getSecretByKey(POSTHOG_CONNECTION_SECRET);
      const value = this.parse(raw);
      // A write invalidated the cache while this read was in flight, so the
      // value is already stale. Return it to this caller but do not cache it
      // over the newer one.
      if (epoch === this.cacheEpoch) {
        this.cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
      }
      return value;
    } catch (error) {
      logger.warn('Unable to load the PostHog connection', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getConfig(): Promise<PosthogConfig> {
    const conn = await this.getConnection();
    return {
      personalApiKey: {
        configured: conn !== null,
        maskedKey: conn ? this.mask(conn.personalApiKey) : null,
      },
      host: conn?.host ?? null,
      posthogProjectId: conn?.posthogProjectId ?? null,
      projectName: conn?.projectName ?? null,
      organizationName: conn?.organizationName ?? null,
    };
  }

  async setConnection(input: Omit<StoredPosthogConnection, 'createdAt'>): Promise<PosthogConfig> {
    const record: StoredPosthogConnection = {
      ...input,
      createdAt: new Date().toISOString(),
    };
    try {
      const secret = await this.findSecret();
      if (secret) {
        // expiresAt: null because taking over an existing row must clear any
        // expiry it carried — getSecretByKey() only matches unexpired rows, so
        // a stale expires_at would make getConfig() report `configured: false`
        // immediately after a successful write.
        const updated = await this.secretService.updateSecret(secret.id, {
          value: JSON.stringify(record),
          isActive: true,
          isReserved: true,
          expiresAt: null,
        });
        if (!updated) {
          throw new Error(`Failed to update ${POSTHOG_CONNECTION_SECRET}`);
        }
      } else {
        try {
          await this.secretService.createSecret({
            key: POSTHOG_CONNECTION_SECRET,
            value: JSON.stringify(record),
            isReserved: true,
          });
        } catch (error) {
          // Two concurrent first-time connects both see no row and both insert;
          // one wins on UNIQUE(key). The loser's credential is still valid, so
          // take over the winner's row instead of failing a good request.
          if (!isDuplicateSecret(error)) {
            throw error;
          }
          const existing = await this.findSecret();
          if (!existing) {
            throw error;
          }
          const updated = await this.secretService.updateSecret(existing.id, {
            value: JSON.stringify(record),
            isActive: true,
            isReserved: true,
            expiresAt: null,
          });
          if (!updated) {
            throw new Error(`Failed to update ${POSTHOG_CONNECTION_SECRET}`);
          }
        }
      }
    } finally {
      this.invalidate();
    }
    return this.getConfig();
  }

  // Stored with isReserved: true, which does not hide the row from the Secrets
  // UI but makes it un-editable and un-deletable through the generic secrets
  // routes (403 "Cannot update/delete reserved secret"). That also puts it out
  // of reach of the default deleteSecretByKey(), whose statement filters on
  // `is_reserved = false` — disconnect must use the reserved-capable path or it
  // removes nothing and still answers 204.
  async deleteConnection(): Promise<void> {
    try {
      const removed = await this.secretService.deleteReservedSecretByKey(POSTHOG_CONNECTION_SECRET);
      // Zero rows deleted with nothing left behind just means there was nothing
      // to delete — disconnect stays idempotent. Zero rows with the secret still
      // present is a real failure and must not be reported as a disconnect.
      if (!removed && (await this.findSecret())) {
        throw new Error(`Failed to delete ${POSTHOG_CONNECTION_SECRET}`);
      }
    } finally {
      this.invalidate();
    }
  }

  // listSecrets() filters nothing, so it also returns soft-deleted rows.
  // getSecretByKey() — the read path — only matches `is_active = true`, so an
  // inactive row here would misreport the connection. Expiry is deliberately
  // not filtered: an expired-but-active row is still the row setConnection()
  // must take over, and it clears the stale expires_at when it does.
  private async findSecret(): Promise<{ id: string; createdAt: string } | undefined> {
    const secrets = await this.secretService.listSecrets();
    return secrets.find((secret) => secret.key === POSTHOG_CONNECTION_SECRET && secret.isActive);
  }

  private invalidate(): void {
    this.cacheEpoch += 1;
    this.cached = null;
  }

  // A row that fails to parse is treated as "not connected" rather than thrown:
  // the only way to produce one is hand-editing the database, and a hard failure
  // there would lock the user out of the reconnect path that fixes it.
  private parse(raw: string | null | undefined): StoredPosthogConnection | null {
    if (!raw?.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StoredPosthogConnection>;
      if (!parsed.personalApiKey || !parsed.host || !parsed.posthogProjectId) {
        logger.warn('Stored PostHog connection is missing required fields; treating as absent');
        return null;
      }
      return {
        personalApiKey: parsed.personalApiKey,
        host: parsed.host,
        posthogProjectId: parsed.posthogProjectId,
        apiKey: parsed.apiKey ?? '',
        organizationName: parsed.organizationName ?? null,
        projectName: parsed.projectName ?? 'Default project',
        createdAt: parsed.createdAt ?? new Date().toISOString(),
      };
    } catch {
      logger.warn('Stored PostHog connection is not valid JSON; treating as absent');
      return null;
    }
  }

  private mask(value: string): string {
    if (value.length <= 12) {
      return '••••••••';
    }
    return `${value.slice(0, 8)}••••••••${value.slice(-4)}`;
  }
}
