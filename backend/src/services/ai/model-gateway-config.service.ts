import type {
  ModelGatewayConfig,
  ModelGatewayCredentialSource,
  UpdateModelGatewayConfig,
} from '@insforge/shared-schemas';
import { SecretService } from '@/services/secrets/secret.service.js';
import logger from '@/utils/logger.js';

const OPENROUTER_API_KEY_SECRET = 'OPENROUTER_API_KEY';
const OPENROUTER_MANAGEMENT_KEY_SECRET = 'OPENROUTER_MANAGEMENT_API_KEY';
const STORED_CREDENTIAL_CACHE_TTL_MS = 60 * 1000;

type SecretStore = Pick<
  SecretService,
  'createSecret' | 'getSecretByKey' | 'listSecrets' | 'updateSecret'
>;

export interface ResolvedModelGatewayCredential {
  value: string;
  source: ModelGatewayCredentialSource;
}

interface StoredCredentialCache {
  apiKey: string | null;
  managementKey: string | null;
  expiresAt: number;
}

export class ModelGatewayConfigService {
  private static instance: ModelGatewayConfigService;
  private storedCredentialCache: StoredCredentialCache | null = null;

  constructor(private readonly secretService: SecretStore = SecretService.getInstance()) {}

  static getInstance(): ModelGatewayConfigService {
    if (!ModelGatewayConfigService.instance) {
      ModelGatewayConfigService.instance = new ModelGatewayConfigService();
    }
    return ModelGatewayConfigService.instance;
  }

  async getApiKey(): Promise<ResolvedModelGatewayCredential | null> {
    return this.resolveStoredCredential((await this.getStoredCredentials()).apiKey);
  }

  async getManagementKey(): Promise<ResolvedModelGatewayCredential | null> {
    return this.resolveStoredCredential((await this.getStoredCredentials()).managementKey);
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

    this.storedCredentialCache = null;
  }

  async getConfig(): Promise<ModelGatewayConfig> {
    const storedCredentials = await this.getStoredCredentials();
    const apiKey = this.resolveStoredCredential(storedCredentials.apiKey);
    const managementKey = this.resolveStoredCredential(storedCredentials.managementKey);

    return {
      apiKey: this.toCredentialStatus(apiKey),
      managementKey: this.toCredentialStatus(managementKey),
    };
  }

  async updateConfig(input: UpdateModelGatewayConfig): Promise<ModelGatewayConfig> {
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

    this.storedCredentialCache = null;
    return this.getConfig();
  }

  private async getStoredCredentials(): Promise<{
    apiKey: string | null;
    managementKey: string | null;
  }> {
    if (this.storedCredentialCache && this.storedCredentialCache.expiresAt > Date.now()) {
      return this.storedCredentialCache;
    }

    try {
      const [apiKey, managementKey] = await Promise.all([
        this.secretService.getSecretByKey(OPENROUTER_API_KEY_SECRET),
        this.secretService.getSecretByKey(OPENROUTER_MANAGEMENT_KEY_SECRET),
      ]);
      this.storedCredentialCache = {
        apiKey: this.normalizeCredential(apiKey),
        managementKey: this.normalizeCredential(managementKey),
        expiresAt: Date.now() + STORED_CREDENTIAL_CACHE_TTL_MS,
      };
    } catch (error) {
      logger.warn('Unable to load dashboard-managed Model Gateway credentials', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.storedCredentialCache = {
        apiKey: null,
        managementKey: null,
        expiresAt: Date.now() + STORED_CREDENTIAL_CACHE_TTL_MS,
      };
    }

    return this.storedCredentialCache;
  }

  private resolveStoredCredential(
    storedValue: string | null
  ): ResolvedModelGatewayCredential | null {
    return storedValue ? { value: storedValue, source: 'dashboard' } : null;
  }

  private normalizeCredential(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private toCredentialStatus(credential: ResolvedModelGatewayCredential | null) {
    return {
      configured: credential !== null,
      source: credential?.source ?? null,
      maskedKey: credential ? this.maskCredential(credential.value) : null,
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
