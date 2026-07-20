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

export class ModelGatewayConfigService {
  private static instance: ModelGatewayConfigService;
  private storedCredentialCache = new Map<ModelGatewayCredentialKey, StoredCredentialCache>();

  constructor(private readonly secretService: SecretStore = SecretService.getInstance()) {}

  static getInstance(): ModelGatewayConfigService {
    if (!ModelGatewayConfigService.instance) {
      ModelGatewayConfigService.instance = new ModelGatewayConfigService();
    }
    return ModelGatewayConfigService.instance;
  }

  async getApiKey(): Promise<string | null> {
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

    this.storedCredentialCache.delete(OPENROUTER_API_KEY_SECRET);
  }

  async getConfig(): Promise<ModelGatewayConfig> {
    const [apiKey, managementKey] = await Promise.all([this.getApiKey(), this.getManagementKey()]);

    return {
      apiKey: this.toCredentialStatus(apiKey),
      managementKey: this.toCredentialStatus(managementKey),
    };
  }

  async updateConfig(input: UpdateModelGatewayConfig): Promise<ModelGatewayConfig> {
    try {
      const secrets = await this.secretService.listSecrets();
      const existingByKey = new Map(secrets.map((secret) => [secret.key, secret]));

      if (input.apiKey !== undefined) {
        await this.upsertCredential(
          OPENROUTER_API_KEY_SECRET,
          input.apiKey,
          existingByKey.get(OPENROUTER_API_KEY_SECRET)
        );
      }

      if (input.managementKey !== undefined) {
        await this.upsertCredential(
          OPENROUTER_MANAGEMENT_KEY_SECRET,
          input.managementKey,
          existingByKey.get(OPENROUTER_MANAGEMENT_KEY_SECRET)
        );
      }
    } finally {
      // The credentials are independent and may update independently. Always invalidate both
      // cache entries so a partial failure is reconciled on the next read.
      this.storedCredentialCache.clear();
    }

    return this.getConfig();
  }

  private async getStoredCredential(key: ModelGatewayCredentialKey): Promise<string | null> {
    const cached = this.storedCredentialCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const value = this.normalizeCredential(await this.secretService.getSecretByKey(key));
      this.storedCredentialCache.set(key, {
        value,
        expiresAt: Date.now() + STORED_CREDENTIAL_CACHE_TTL_MS,
      });
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
