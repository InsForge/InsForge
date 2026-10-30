import type { ModelGatewayConfig, UpdateModelGatewayConfig } from '@insforge/shared-schemas';
import { SecretService } from '@/services/secrets/secret.service.js';
import logger from '@/utils/logger.js';

const OPENROUTER_API_KEY_SECRET = 'OPENROUTER_API_KEY';
const OPENROUTER_MANAGEMENT_KEY_SECRET = 'OPENROUTER_MANAGEMENT_API_KEY';
const STORED_CREDENTIAL_CACHE_TTL_MS = 60 * 1000;

type SecretStore = Pick<
  SecretService,
  'createSecret' | 'getSecretByKey' | 'listSecrets' | 'updateSecret'
>;

interface StoredCredentialCache {
  value: string | null;
  expiresAt: number;
}

type ModelGatewayCredentialKey =
  | typeof OPENROUTER_API_KEY_SECRET
  | typeof OPENROUTER_MANAGEMENT_KEY_SECRET;

export type ModelGatewayConfigField = keyof UpdateModelGatewayConfig;

interface ModelGatewayCredentialUpdate {
  field: ModelGatewayConfigField;
  operation: Promise<void>;
}

export class ModelGatewayConfigUpdateError extends Error {
  constructor(
    message: string,
    readonly succeededFields: ModelGatewayConfigField[],
    readonly failedFields: ModelGatewayConfigField[],
    cause: unknown
  ) {
    super(message, { cause });
    this.name = 'ModelGatewayConfigUpdateError';
  }
}

export class ModelGatewayConfigService {
  private static instance: ModelGatewayConfigService;
  private storedCredentialCache = new Map<ModelGatewayCredentialKey, StoredCredentialCache>();
  // Bumped on every invalidation. Clearing the map cannot cancel a read that is
  // already awaiting the secret store, so `getStoredCredential` captures this
  // before its await and declines to cache a value fetched under an older epoch.
  private storedCredentialCacheEpoch = 0;

  constructor(private readonly secretService: SecretStore = SecretService.getInstance()) {}

  static getInstance(): ModelGatewayConfigService {
    if (!ModelGatewayConfigService.instance) {
      ModelGatewayConfigService.instance = new ModelGatewayConfigService();
    }
    return ModelGatewayConfigService.instance;
  }

  async getApiKey(): Promise<string | null> {
    // Fall back to the bootstrap env key only when no stored key exists. Secret-store failures
    // propagate deliberately so a database or decryption outage cannot silently revive a stale key.
    const storedApiKey = await this.getStoredCredential(OPENROUTER_API_KEY_SECRET);
    return storedApiKey ?? this.normalizeCredential(process.env.OPENROUTER_API_KEY);
  }

  async getManagementKey(): Promise<string | null> {
    return this.getStoredCredential(OPENROUTER_MANAGEMENT_KEY_SECRET);
  }

  async seedApiKeyFromEnv(): Promise<void> {
    let existingKeys: Set<string>;
    try {
      const existingSecrets = await this.secretService.listSecrets();
      existingKeys = new Set(existingSecrets.map((secret) => secret.key));
    } catch (error) {
      logger.warn('Failed to inspect existing Model Gateway credentials', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const apiKey = this.normalizeCredential(process.env.OPENROUTER_API_KEY);
    if (!apiKey || existingKeys.has(OPENROUTER_API_KEY_SECRET)) {
      return;
    }

    try {
      await this.secretService.createSecret({
        key: OPENROUTER_API_KEY_SECRET,
        value: apiKey,
        isReserved: true,
      });
      logger.info(`✅ ${OPENROUTER_API_KEY_SECRET} secret initialized`);
    } catch (error) {
      logger.warn(`Failed to initialize ${OPENROUTER_API_KEY_SECRET}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Seeding wrote a credential, so drop the cached entry and retire any read
    // already in flight along with it.
    this.storedCredentialCacheEpoch += 1;
    this.storedCredentialCache.delete(OPENROUTER_API_KEY_SECRET);
  }

  private invalidateStoredCredentialCache(): void {
    this.storedCredentialCacheEpoch += 1;
    this.storedCredentialCache.clear();
  }

  async getConfig(): Promise<ModelGatewayConfig> {
    const [apiKey, managementKey] = await Promise.all([this.getApiKey(), this.getManagementKey()]);

    return {
      apiKey: this.toCredentialStatus(apiKey),
      managementKey: this.toCredentialStatus(managementKey),
    };
  }

  async updateConfig(input: UpdateModelGatewayConfig): Promise<ModelGatewayConfig> {
    const succeededFields: ModelGatewayConfigField[] = [];

    try {
      const secrets = await this.secretService.listSecrets();
      const existingByKey = new Map(secrets.map((secret) => [secret.key, secret]));
      const updates: ModelGatewayCredentialUpdate[] = [];

      if (input.apiKey !== undefined) {
        updates.push({
          field: 'apiKey',
          operation: this.upsertCredential(
            OPENROUTER_API_KEY_SECRET,
            input.apiKey,
            existingByKey.get(OPENROUTER_API_KEY_SECRET)
          ),
        });
      }

      if (input.managementKey !== undefined) {
        updates.push({
          field: 'managementKey',
          operation: this.upsertCredential(
            OPENROUTER_MANAGEMENT_KEY_SECRET,
            input.managementKey,
            existingByKey.get(OPENROUTER_MANAGEMENT_KEY_SECRET)
          ),
        });
      }

      const results = await Promise.allSettled(updates.map((update) => update.operation));
      const failedFields: ModelGatewayConfigField[] = [];
      let firstFailure: unknown;

      results.forEach((result, index) => {
        const field = updates[index].field;
        if (result.status === 'fulfilled') {
          succeededFields.push(field);
          return;
        }

        failedFields.push(field);
        firstFailure ??= result.reason;
      });

      if (failedFields.length > 0) {
        const message = firstFailure instanceof Error ? firstFailure.message : String(firstFailure);
        throw new ModelGatewayConfigUpdateError(
          message,
          succeededFields,
          failedFields,
          firstFailure
        );
      }
    } finally {
      // The credentials are independent and may update independently. Always invalidate both
      // cache entries so a partial failure is reconciled on the next read.
      this.invalidateStoredCredentialCache();
    }

    try {
      return await this.getConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ModelGatewayConfigUpdateError(message, succeededFields, [], error);
    }
  }

  private async getStoredCredential(key: ModelGatewayCredentialKey): Promise<string | null> {
    const cached = this.storedCredentialCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const epoch = this.storedCredentialCacheEpoch;

    try {
      const value = this.normalizeCredential(await this.secretService.getSecretByKey(key));
      // An update invalidated the cache while this read was in flight, so the value
      // it just fetched is already stale. Hand it back to this caller, but leave the
      // cache alone — writing it here would clobber the post-update value with the
      // superseded credential for a further TTL window.
      if (epoch === this.storedCredentialCacheEpoch) {
        this.storedCredentialCache.set(key, {
          value,
          expiresAt: Date.now() + STORED_CREDENTIAL_CACHE_TTL_MS,
        });
      }
      return value;
    } catch (error) {
      logger.warn('Unable to load a Model Gateway credential', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private normalizeCredential(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private toCredentialStatus(credential: string | null) {
    return {
      configured: credential !== null,
      maskedKey: credential ? this.maskCredential(credential) : null,
    };
  }

  private maskCredential(value: string): string {
    if (value.length <= 12) {
      return '••••••••';
    }
    return `${value.slice(0, 8)}••••••••${value.slice(-4)}`;
  }

  private async upsertCredential(
    key: string,
    value: string,
    existing: { id: string } | undefined
  ): Promise<void> {
    if (existing) {
      const updated = await this.secretService.updateSecret(existing.id, {
        value: value.trim(),
        isActive: true,
        isReserved: true,
      });
      if (!updated) {
        throw new Error(`Failed to update ${key}`);
      }
      return;
    }

    await this.secretService.createSecret({
      key,
      value: value.trim(),
      isReserved: true,
    });
  }
}
