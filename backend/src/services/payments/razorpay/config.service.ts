import type { Pool, PoolClient } from 'pg';

import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { AppError } from '@/utils/errors.js';
import {
  RazorpayProvider,
  validateRazorpayKey,
  maskRazorpayKey,
} from '@/providers/payments/razorpay.provider.js';
import { getApiBaseUrl } from '@/utils/environment.js';
import { toISOStringOrNull } from '@/utils/dates.js';
import logger from '@/utils/logger.js';
import { generateSecureToken } from '@/utils/utils.js';
import { withPaymentSessionAdvisoryLock } from '@/services/payments/payments-advisory-lock.js';
import {
  RAZORPAY_ENVIRONMENTS,
  type RazorpayEnvironment,
  type RazorpayConnectionRow,
} from '@/types/payments.js';
import {
  ERROR_CODES,
  type GetRazorpayWebhookSetupResponse,
  type RazorpayConnection,
  type RazorpayKeyConfig,
} from '@insforge/shared-schemas';

const RAZORPAY_KEY_ID_BY_ENVIRONMENT: Record<RazorpayEnvironment, string> = {
  test: 'RAZORPAY_TEST_KEY_ID',
  live: 'RAZORPAY_LIVE_KEY_ID',
};

const RAZORPAY_KEY_SECRET_BY_ENVIRONMENT: Record<RazorpayEnvironment, string> = {
  test: 'RAZORPAY_TEST_KEY_SECRET',
  live: 'RAZORPAY_LIVE_KEY_SECRET',
};

const RAZORPAY_WEBHOOK_SECRET_BY_ENVIRONMENT: Record<RazorpayEnvironment, string> = {
  test: 'RAZORPAY_TEST_WEBHOOK_SECRET',
  live: 'RAZORPAY_LIVE_WEBHOOK_SECRET',
};

type SyncRazorpayAfterKeyChange = (
  environment: RazorpayEnvironment,
  provider: RazorpayProvider
) => Promise<void>;

function getRazorpayKeyIdName(environment: RazorpayEnvironment): string {
  return RAZORPAY_KEY_ID_BY_ENVIRONMENT[environment];
}

function getRazorpayKeySecretName(environment: RazorpayEnvironment): string {
  return RAZORPAY_KEY_SECRET_BY_ENVIRONMENT[environment];
}

function getRazorpayWebhookSecretName(environment: RazorpayEnvironment): string {
  return RAZORPAY_WEBHOOK_SECRET_BY_ENVIRONMENT[environment];
}

export class RazorpayConfigService {
  private static instance: RazorpayConfigService;
  private pool: Pool | null = null;

  static getInstance(): RazorpayConfigService {
    if (!RazorpayConfigService.instance) {
      RazorpayConfigService.instance = new RazorpayConfigService();
    }
    return RazorpayConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  private async withEnvironmentLock<T>(
    environment: RazorpayEnvironment,
    task: () => Promise<T>
  ): Promise<T> {
    return withPaymentSessionAdvisoryLock(
      this.getPool(),
      `payments_razorpay_environment_${environment}`,
      task
    );
  }

  listRazorpayEnvironments(): RazorpayEnvironment[] {
    return [...RAZORPAY_ENVIRONMENTS];
  }

  async getRazorpayKeyId(environment: RazorpayEnvironment): Promise<string | null> {
    const keyId = await SecretService.getInstance().getSecretByKey(
      getRazorpayKeyIdName(environment)
    );
    if (!keyId) {
      return null;
    }
    validateRazorpayKey(environment, keyId);
    return keyId;
  }

  async getRazorpayKeySecret(environment: RazorpayEnvironment): Promise<string | null> {
    return SecretService.getInstance().getSecretByKey(getRazorpayKeySecretName(environment));
  }

  async getRazorpayWebhookSecret(environment: RazorpayEnvironment): Promise<string | null> {
    return SecretService.getInstance().getSecretByKey(getRazorpayWebhookSecretName(environment));
  }

  async setRazorpayKeys(
    environment: RazorpayEnvironment,
    keyId: string,
    keySecret: string,
    webhookSecret?: string,
    syncAfterKeyChange?: SyncRazorpayAfterKeyChange
  ): Promise<void> {
    return this.withEnvironmentLock(environment, async () => {
      const trimmedKeyId = keyId.trim();
      const trimmedKeySecret = keySecret.trim();
      const trimmedWebhookSecret = webhookSecret?.trim();

      validateRazorpayKey(environment, trimmedKeyId);
      if (!trimmedKeySecret) {
        throw new AppError(
          'Razorpay key secret is required',
          400,
          ERROR_CODES.PAYMENT_CONFIG_INVALID
        );
      }

      const keyIdKey = getRazorpayKeyIdName(environment);
      const keySecretKey = getRazorpayKeySecretName(environment);
      const webhookSecretKey = getRazorpayWebhookSecretName(environment);
      const secretService = SecretService.getInstance();

      const [existingKeyId, existingKeySecret, existingWebhookSecret, currentRazorpayAccountId] =
        await Promise.all([
          secretService.getSecretByKey(keyIdKey),
          secretService.getSecretByKey(keySecretKey),
          secretService.getSecretByKey(webhookSecretKey),
          this.getCurrentRazorpayAccountId(environment),
        ]);

      const provider = new RazorpayProvider(trimmedKeyId, trimmedKeySecret, environment);
      const account = await provider.retrieveAccount();
      const keysChanged = existingKeyId !== trimmedKeyId || existingKeySecret !== trimmedKeySecret;
      const shouldClearPaymentData =
        currentRazorpayAccountId !== null && currentRazorpayAccountId !== account.id;

      const encryptedKeyId = EncryptionManager.encrypt(trimmedKeyId);
      const encryptedKeySecret = EncryptionManager.encrypt(trimmedKeySecret);

      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');

        if (shouldClearPaymentData) {
          await this.clearPaymentData(client, environment);
          logger.info('Cleared synced Razorpay payment data after account key change', {
            environment,
          });
        }

        await client.query(
          `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
           VALUES ($1, $2, true, true)
           ON CONFLICT (key) DO UPDATE SET
             value_ciphertext = EXCLUDED.value_ciphertext,
             is_active        = true,
             is_reserved      = true,
             updated_at       = NOW()`,
          [keyIdKey, encryptedKeyId]
        );

        await client.query(
          `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
           VALUES ($1, $2, true, true)
           ON CONFLICT (key) DO UPDATE SET
             value_ciphertext = EXCLUDED.value_ciphertext,
             is_active        = true,
             is_reserved      = true,
             updated_at       = NOW()`,
          [keySecretKey, encryptedKeySecret]
        );

        if (trimmedWebhookSecret || !existingWebhookSecret) {
          const encryptedWebhookSecret = EncryptionManager.encrypt(
            trimmedWebhookSecret || generateSecureToken(32)
          );
          await client.query(
            `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
             VALUES ($1, $2, true, true)
             ON CONFLICT (key) DO UPDATE SET
               value_ciphertext = EXCLUDED.value_ciphertext,
               is_active        = true,
               is_reserved      = true,
               updated_at       = NOW()`,
            [webhookSecretKey, encryptedWebhookSecret]
          );
        }

        await client.query(
          `INSERT INTO payments.provider_connections (
             provider,
             environment,
             status,
             provider_account_id,
             account_name,
             account_livemode,
             webhook_endpoint_id,
             webhook_endpoint_url,
             webhook_configured_at,
             last_synced_at,
             last_sync_status,
             last_sync_error,
             last_sync_counts
           )
           VALUES ('razorpay', $1, 'connected', $2, $3, $4, NULL, NULL, NULL, NULL, NULL, NULL, '{}'::JSONB)
           ON CONFLICT (provider, environment) DO UPDATE SET
             status = 'connected',
             provider_account_id = EXCLUDED.provider_account_id,
             account_name = EXCLUDED.account_name,
             account_livemode = EXCLUDED.account_livemode,
             webhook_endpoint_id = CASE
               WHEN $5 THEN NULL
               ELSE payments.provider_connections.webhook_endpoint_id
             END,
             webhook_endpoint_url = CASE
               WHEN $5 THEN NULL
               ELSE payments.provider_connections.webhook_endpoint_url
             END,
             webhook_configured_at = CASE
               WHEN $5 THEN NULL
               ELSE payments.provider_connections.webhook_configured_at
             END,
             last_synced_at = CASE
               WHEN $5 THEN NULL
               ELSE payments.provider_connections.last_synced_at
             END,
             last_sync_status = CASE
               WHEN $5 THEN NULL
               ELSE payments.provider_connections.last_sync_status
             END,
             last_sync_error = CASE
               WHEN $5 THEN NULL
               ELSE payments.provider_connections.last_sync_error
             END,
             last_sync_counts = CASE
               WHEN $5 THEN '{}'::JSONB
               ELSE payments.provider_connections.last_sync_counts
             END,
             updated_at = NOW()`,
          [environment, account.id, account.merchantName, account.livemode, shouldClearPaymentData]
        );

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      if (syncAfterKeyChange && (keysChanged || !currentRazorpayAccountId)) {
        await syncAfterKeyChange(environment, provider);
      }
    });
  }

  async getCurrentRazorpayAccountId(environment: RazorpayEnvironment): Promise<string | null> {
    const result = await this.getPool().query(
      `SELECT provider_account_id AS "accountId"
       FROM payments.provider_connections
       WHERE provider = 'razorpay'
         AND environment = $1`,
      [environment]
    );

    const row = result.rows[0] as { accountId: string | null } | undefined;
    return row?.accountId ?? null;
  }

  async setRazorpayWebhookSecret(
    environment: RazorpayEnvironment,
    webhookSecret: string
  ): Promise<void> {
    await this.getPool().query(
      `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
       VALUES ($1, $2, true, true)
       ON CONFLICT (key) DO UPDATE SET
         value_ciphertext = EXCLUDED.value_ciphertext,
         is_active        = true,
         is_reserved      = true,
         updated_at       = NOW()`,
      [getRazorpayWebhookSecretName(environment), EncryptionManager.encrypt(webhookSecret)]
    );
  }

  async removeRazorpayKeys(environment: RazorpayEnvironment): Promise<boolean> {
    return this.withEnvironmentLock(environment, async () => {
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const resultId = await client.query(
          `UPDATE system.secrets SET is_active = false, updated_at = NOW()
           WHERE key = $1 AND is_active = true`,
          [getRazorpayKeyIdName(environment)]
        );
        const resultSecret = await client.query(
          `UPDATE system.secrets SET is_active = false, updated_at = NOW()
           WHERE key = $1 AND is_active = true`,
          [getRazorpayKeySecretName(environment)]
        );
        await client.query(
          `UPDATE system.secrets SET is_active = false, updated_at = NOW()
           WHERE key = $1 AND is_active = true`,
          [getRazorpayWebhookSecretName(environment)]
        );

        const removed = (resultId.rowCount ?? 0) > 0 || (resultSecret.rowCount ?? 0) > 0;
        if (removed) {
          await client.query(
            `UPDATE payments.provider_connections
             SET status = 'unconfigured',
                 webhook_endpoint_id = NULL,
                 webhook_endpoint_url = NULL,
                 webhook_configured_at = NULL,
                 last_synced_at = NULL,
                 last_sync_status = 'failed',
                 last_sync_error = $2,
                 last_sync_counts = '{}'::JSONB,
                 updated_at = NOW()
             WHERE provider = 'razorpay'
               AND environment = $1`,
            [environment, `Razorpay ${environment} keys are not configured`]
          );
        }
        await client.query('COMMIT');
        return removed;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async createRazorpayProvider(environment: RazorpayEnvironment): Promise<RazorpayProvider> {
    const [keyId, keySecret] = await Promise.all([
      this.getRazorpayKeyId(environment),
      this.getRazorpayKeySecret(environment),
    ]);

    if (!keyId || !keySecret) {
      throw new AppError(
        `Razorpay ${environment} keys are not configured`,
        400,
        ERROR_CODES.PAYMENT_CONFIG_NOT_FOUND
      );
    }

    return new RazorpayProvider(keyId, keySecret, environment);
  }

  async getConnection(environment: RazorpayEnvironment): Promise<RazorpayConnection> {
    const row = await this.getPool().query<RazorpayConnectionRow>(
      `SELECT
         environment,
         status,
         provider_account_id      AS "accountId",
         account_name             AS "merchantName",
         account_livemode         AS "accountLivemode",
         webhook_endpoint_id      AS "webhookEndpointId",
         webhook_endpoint_url     AS "webhookEndpointUrl",
         webhook_configured_at    AS "webhookConfiguredAt",
         last_synced_at           AS "lastSyncedAt",
         last_sync_status         AS "lastSyncStatus",
         last_sync_error          AS "lastSyncError",
         last_sync_counts         AS "lastSyncCounts"
       FROM payments.provider_connections
       WHERE provider = 'razorpay'
         AND environment = $1`,
      [environment]
    );

    if (row.rowCount === 0) {
      return this.buildUnconfiguredConnection(environment);
    }

    const keyId = await this.getRazorpayKeyId(environment);
    const maskedKey = keyId ? maskRazorpayKey(keyId) : null;

    return this.normalizeConnectionRow(row.rows[0] as RazorpayConnectionRow, maskedKey);
  }

  async getRazorpayStatus(): Promise<RazorpayConnection[]> {
    const environments = this.listRazorpayEnvironments();
    return Promise.all(environments.map((env) => this.getConnection(env)));
  }

  async getKeyConfig(): Promise<RazorpayKeyConfig[]> {
    const environments = this.listRazorpayEnvironments();
    return Promise.all(
      environments.flatMap((env) => [
        this.buildKeyConfig(env, 'api_key', getRazorpayKeyIdName(env)),
        this.buildKeyConfig(env, 'api_secret', getRazorpayKeySecretName(env)),
        this.buildKeyConfig(env, 'webhook_secret', getRazorpayWebhookSecretName(env)),
      ])
    );
  }

  private async buildKeyConfig(
    environment: RazorpayEnvironment,
    keyType: RazorpayKeyConfig['keyType'],
    secretName: string
  ): Promise<RazorpayKeyConfig> {
    const raw = await SecretService.getInstance().getSecretByKey(secretName);
    return {
      environment,
      keyType,
      value: raw,
    };
  }

  async recordConnectionStatus(
    environment: RazorpayEnvironment,
    status: 'unconfigured' | 'error',
    errorMessage?: string | null
  ): Promise<RazorpayConnection> {
    await this.getPool().query(
      `INSERT INTO payments.provider_connections
         (provider, environment, status, last_sync_status, last_sync_error, last_sync_counts, updated_at)
       VALUES ('razorpay', $1, $2, 'failed', $3, '{}'::JSONB, NOW())
       ON CONFLICT (provider, environment) DO UPDATE SET
         status           = EXCLUDED.status,
         last_sync_status = 'failed',
         last_sync_error  = EXCLUDED.last_sync_error,
         last_sync_counts = EXCLUDED.last_sync_counts,
         webhook_endpoint_id = CASE
           WHEN $2 = 'unconfigured' THEN NULL
           ELSE payments.provider_connections.webhook_endpoint_id
         END,
         webhook_endpoint_url = CASE
           WHEN $2 = 'unconfigured' THEN NULL
           ELSE payments.provider_connections.webhook_endpoint_url
         END,
         webhook_configured_at = CASE
           WHEN $2 = 'unconfigured' THEN NULL
           ELSE payments.provider_connections.webhook_configured_at
         END,
         updated_at       = NOW()`,
      [environment, status, errorMessage ?? null]
    );
    return this.getConnection(environment);
  }

  async writeSnapshot(
    environment: RazorpayEnvironment,
    accountId: string,
    merchantName: string | null,
    livemode: boolean,
    syncCounts: Record<string, number>,
    syncedAt: Date
  ): Promise<void> {
    await this.getPool().query(
      `INSERT INTO payments.provider_connections
         (provider, environment, status, provider_account_id, account_name,
          account_livemode, last_synced_at, last_sync_status, last_sync_counts,
          last_sync_error, updated_at)
       VALUES ('razorpay', $1, 'connected', $2, $3, $4, $5, 'succeeded', $6, NULL, NOW())
       ON CONFLICT (provider, environment) DO UPDATE SET
         status                = 'connected',
         provider_account_id   = EXCLUDED.provider_account_id,
         account_name          = EXCLUDED.account_name,
         account_livemode      = EXCLUDED.account_livemode,
         last_synced_at        = EXCLUDED.last_synced_at,
         last_sync_status      = 'succeeded',
         last_sync_counts      = EXCLUDED.last_sync_counts,
         last_sync_error       = NULL,
         updated_at            = NOW()`,
      [environment, accountId, merchantName, livemode, syncedAt, syncCounts]
    );
  }

  async writeFailedSnapshot(
    environment: RazorpayEnvironment,
    accountId: string,
    merchantName: string | null,
    livemode: boolean,
    syncCounts: Record<string, number>,
    errorMessage: string,
    syncedAt: Date
  ): Promise<void> {
    await this.getPool().query(
      `INSERT INTO payments.provider_connections
         (provider, environment, status, provider_account_id, account_name,
          account_livemode, last_synced_at, last_sync_status, last_sync_counts,
          last_sync_error, updated_at)
       VALUES ('razorpay', $1, 'connected', $2, $3, $4, $5, 'failed', $6, $7, NOW())
       ON CONFLICT (provider, environment) DO UPDATE SET
         status                = 'connected',
         provider_account_id   = EXCLUDED.provider_account_id,
         account_name          = EXCLUDED.account_name,
         account_livemode      = EXCLUDED.account_livemode,
         last_synced_at        = EXCLUDED.last_synced_at,
         last_sync_status      = 'failed',
         last_sync_counts      = EXCLUDED.last_sync_counts,
         last_sync_error       = EXCLUDED.last_sync_error,
         updated_at            = NOW()`,
      [environment, accountId, merchantName, livemode, syncedAt, syncCounts, errorMessage]
    );
  }

  private async clearPaymentData(
    client: PoolClient,
    environment: RazorpayEnvironment
  ): Promise<void> {
    await client.query('DELETE FROM payments.razorpay_subscriptions WHERE environment = $1', [
      environment,
    ]);
    await client.query(
      'DELETE FROM payments.transactions WHERE provider = $1 AND environment = $2',
      ['razorpay', environment]
    );
    await client.query('DELETE FROM payments.razorpay_orders WHERE environment = $1', [
      environment,
    ]);
    await client.query('DELETE FROM payments.customers WHERE environment = $1 AND provider = $2', [
      environment,
      'razorpay',
    ]);
    await client.query(
      'DELETE FROM payments.customer_mappings WHERE environment = $1 AND provider = $2',
      [environment, 'razorpay']
    );
    await client.query(
      'DELETE FROM payments.webhook_events WHERE environment = $1 AND provider = $2',
      [environment, 'razorpay']
    );
    await client.query('DELETE FROM payments.razorpay_plans WHERE environment = $1', [environment]);
    await client.query('DELETE FROM payments.razorpay_items WHERE environment = $1', [environment]);
  }

  async getWebhookSetup(
    environment: RazorpayEnvironment
  ): Promise<GetRazorpayWebhookSetupResponse> {
    await this.createRazorpayProvider(environment);
    const webhookSecret = await this.ensureRazorpayWebhookSecret(environment);
    const webhookUrl = this.getWebhookUrl(environment);

    await this.upsertManualWebhookConnection(environment, webhookUrl);

    return {
      connection: await this.getConnection(environment),
      webhookUrl,
      webhookSecret,
    };
  }

  async rotateWebhookSecret(
    environment: RazorpayEnvironment
  ): Promise<GetRazorpayWebhookSetupResponse> {
    await this.createRazorpayProvider(environment);

    const webhookSecret = generateSecureToken(32);
    await this.setRazorpayWebhookSecret(environment, webhookSecret);

    const webhookUrl = this.getWebhookUrl(environment);
    await this.upsertManualWebhookConnection(environment, webhookUrl);

    logger.info('Razorpay webhook secret rotated', {
      environment,
      webhookUrl,
    });

    return {
      connection: await this.getConnection(environment),
      webhookUrl,
      webhookSecret,
    };
  }

  private getWebhookUrl(environment: RazorpayEnvironment): string {
    return `${getApiBaseUrl().replace(/\/+$/, '')}/api/webhooks/razorpay/${environment}`;
  }

  private async ensureRazorpayWebhookSecret(environment: RazorpayEnvironment): Promise<string> {
    const existingSecret = await this.getRazorpayWebhookSecret(environment);
    if (existingSecret) {
      return existingSecret;
    }

    const webhookSecret = generateSecureToken(32);
    await this.setRazorpayWebhookSecret(environment, webhookSecret);
    return webhookSecret;
  }

  private async upsertManualWebhookConnection(
    environment: RazorpayEnvironment,
    webhookUrl: string
  ): Promise<void> {
    await this.getPool().query(
      `INSERT INTO payments.provider_connections
         (provider, environment, webhook_endpoint_id, webhook_endpoint_url, webhook_configured_at, updated_at)
       VALUES ('razorpay', $1, 'manual', $2, NOW(), NOW())
       ON CONFLICT (provider, environment) DO UPDATE SET
         webhook_endpoint_id   = 'manual',
         webhook_endpoint_url  = EXCLUDED.webhook_endpoint_url,
         webhook_configured_at = EXCLUDED.webhook_configured_at,
         updated_at            = EXCLUDED.updated_at`,
      [environment, webhookUrl]
    );

    logger.info('Razorpay webhook setup values prepared', {
      environment,
      webhookUrl,
    });
  }

  private normalizeConnectionRow(
    row: RazorpayConnectionRow,
    maskedKey: string | null
  ): RazorpayConnection {
    return {
      environment: row.environment,
      status: row.status,
      accountId: row.accountId ?? null,
      merchantName: row.merchantName ?? null,
      accountLivemode: row.accountLivemode ?? null,
      webhookEndpointId: row.webhookEndpointId ?? null,
      webhookEndpointUrl: row.webhookEndpointUrl ?? null,
      webhookConfiguredAt: toISOStringOrNull(row.webhookConfiguredAt),
      maskedKey,
      lastSyncedAt: toISOStringOrNull(row.lastSyncedAt),
      lastSyncStatus: row.lastSyncStatus ?? null,
      lastSyncError: row.lastSyncError ?? null,
      lastSyncCounts: row.lastSyncCounts ?? {},
    };
  }

  private buildUnconfiguredConnection(environment: RazorpayEnvironment): RazorpayConnection {
    return {
      environment,
      status: 'unconfigured',
      accountId: null,
      merchantName: null,
      accountLivemode: null,
      webhookEndpointId: null,
      webhookEndpointUrl: null,
      webhookConfiguredAt: null,
      maskedKey: null,
      lastSyncedAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
      lastSyncCounts: {},
    };
  }
}
