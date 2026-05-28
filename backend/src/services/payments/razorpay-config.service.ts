import type { Pool } from 'pg';
import crypto from 'crypto';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { AppError } from '@/utils/errors.js';
import {
  RazorpayProvider,
  validateRazorpayKey,
  maskRazorpayKey,
} from '@/providers/payments/razorpay.provider.js';
import {
  RAZORPAY_KEY_ID_BY_ENVIRONMENT,
  RAZORPAY_KEY_SECRET_BY_ENVIRONMENT,
  RAZORPAY_WEBHOOK_SECRET_BY_ENVIRONMENT,
  RAZORPAY_MANAGED_WEBHOOK_EVENTS,
} from '@/services/payments/constants.js';
import { getApiBaseUrl } from '@/utils/environment.js';
import logger from '@/utils/logger.js';
import { generateSecureToken } from '@/utils/utils.js';
import {
  RAZORPAY_ENVIRONMENTS,
  type RazorpayEnvironment,
  type RazorpayConnectionRow,
} from '@/types/payments.js';
import { ERROR_CODES, type RazorpayConnection, type RazorpayKeyConfig } from '@insforge/shared-schemas';

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

  // ─── Secret Key Management ──────────────────────────────────────────────────

  async getRazorpayKeyId(environment: RazorpayEnvironment): Promise<string | null> {
    const keyId = await SecretService.getInstance().getSecretByKey(
      RAZORPAY_KEY_ID_BY_ENVIRONMENT[environment]
    );
    if (!keyId) return null;
    validateRazorpayKey(environment, keyId);
    return keyId;
  }

  async getRazorpayKeySecret(environment: RazorpayEnvironment): Promise<string | null> {
    return SecretService.getInstance().getSecretByKey(
      RAZORPAY_KEY_SECRET_BY_ENVIRONMENT[environment]
    );
  }

  async getRazorpayWebhookSecret(environment: RazorpayEnvironment): Promise<string | null> {
    return SecretService.getInstance().getSecretByKey(
      RAZORPAY_WEBHOOK_SECRET_BY_ENVIRONMENT[environment]
    );
  }

  async setRazorpayKeys(
    environment: RazorpayEnvironment,
    keyId: string,
    keySecret: string,
    webhookSecret?: string
  ): Promise<void> {
    const keyIdKey = RAZORPAY_KEY_ID_BY_ENVIRONMENT[environment];
    const keySecretKey = RAZORPAY_KEY_SECRET_BY_ENVIRONMENT[environment];
    const webhookSecretKey = RAZORPAY_WEBHOOK_SECRET_BY_ENVIRONMENT[environment];

    const encryptedKeyId = EncryptionManager.encrypt(keyId);
    const encryptedKeySecret = EncryptionManager.encrypt(keySecret);

    await this.getPool().query('BEGIN');
    try {
      // Save Key ID
      await this.getPool().query(
        `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
         VALUES ($1, $2, true, true)
         ON CONFLICT (key) DO UPDATE SET
           value_ciphertext = EXCLUDED.value_ciphertext,
           is_active        = true,
           is_reserved      = true,
           updated_at       = NOW()`,
        [keyIdKey, encryptedKeyId]
      );

      // Save Key Secret
      await this.getPool().query(
        `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
         VALUES ($1, $2, true, true)
         ON CONFLICT (key) DO UPDATE SET
           value_ciphertext = EXCLUDED.value_ciphertext,
           is_active        = true,
           is_reserved      = true,
           updated_at       = NOW()`,
        [keySecretKey, encryptedKeySecret]
      );

      // Save Webhook Secret (if provided)
      if (webhookSecret) {
        const encryptedWebhookSecret = EncryptionManager.encrypt(webhookSecret);
        await this.getPool().query(
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

      await this.getPool().query('COMMIT');
    } catch (error) {
      await this.getPool().query('ROLLBACK');
      throw error;
    }
  }

  async removeRazorpayKeys(environment: RazorpayEnvironment): Promise<boolean> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      const resultId = await client.query(
        `UPDATE system.secrets SET is_active = false, updated_at = NOW()
         WHERE key = $1 AND is_active = true`,
        [RAZORPAY_KEY_ID_BY_ENVIRONMENT[environment]]
      );
      const resultSecret = await client.query(
        `UPDATE system.secrets SET is_active = false, updated_at = NOW()
         WHERE key = $1 AND is_active = true`,
        [RAZORPAY_KEY_SECRET_BY_ENVIRONMENT[environment]]
      );
      const resultWebhook = await client.query(
        `UPDATE system.secrets SET is_active = false, updated_at = NOW()
         WHERE key = $1 AND is_active = true`,
        [RAZORPAY_WEBHOOK_SECRET_BY_ENVIRONMENT[environment]]
      );

      const removed = (resultId.rowCount ?? 0) > 0 || (resultSecret.rowCount ?? 0) > 0;
      if (removed) {
        await client.query(
          `UPDATE payments.razorpay_connections
           SET status = 'unconfigured',
               webhook_endpoint_id = NULL,
               webhook_endpoint_url = NULL,
               webhook_configured_at = NULL,
               last_synced_at = NULL,
               last_sync_status = 'failed',
               last_sync_error = $2,
               last_sync_counts = '{}'::JSONB,
               updated_at = NOW()
           WHERE environment = $1`,
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
  }

  // ─── Provider Factory ───────────────────────────────────────────────────────

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

  // ─── Connection / Status ────────────────────────────────────────────────────

  async getConnection(environment: RazorpayEnvironment): Promise<RazorpayConnection> {
    const row = await this.getPool().query<RazorpayConnectionRow>(
      `SELECT
         environment,
         status,
         razorpay_account_id      AS "razorpayAccountId",
         razorpay_merchant_name   AS "razorpayMerchantName",
         account_livemode         AS "accountLivemode",
         webhook_endpoint_id      AS "webhookEndpointId",
         webhook_endpoint_url     AS "webhookEndpointUrl",
         webhook_configured_at    AS "webhookConfiguredAt",
         last_synced_at           AS "lastSyncedAt",
         last_sync_status         AS "lastSyncStatus",
         last_sync_error          AS "lastSyncError",
         last_sync_counts         AS "lastSyncCounts"
       FROM payments.razorpay_connections
       WHERE environment = $1`,
      [environment]
    );

    if (row.rowCount === 0) {
      return this.buildUnconfiguredConnection(environment);
    }

    const keyId = await this.getRazorpayKeyId(environment);
    const maskedKey = keyId ? maskRazorpayKey(keyId) : null;

    return this.normalizeConnectionRow(row.rows[0]!, maskedKey);
  }

  async getRazorpayStatus(): Promise<RazorpayConnection[]> {
    return Promise.all(RAZORPAY_ENVIRONMENTS.map((env) => this.getConnection(env)));
  }

  async getKeyConfig(): Promise<RazorpayKeyConfig[]> {
    return Promise.all(
      RAZORPAY_ENVIRONMENTS.flatMap((env) => [
        this.buildKeyConfig(env, 'api_key', RAZORPAY_KEY_ID_BY_ENVIRONMENT[env]),
        this.buildKeyConfig(env, 'api_secret', RAZORPAY_KEY_SECRET_BY_ENVIRONMENT[env]),
        this.buildKeyConfig(env, 'webhook_secret', RAZORPAY_WEBHOOK_SECRET_BY_ENVIRONMENT[env]),
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
      hasKey: Boolean(raw),
      maskedKey: raw ? maskRazorpayKey(raw) : null,
    };
  }

  async recordConnectionStatus(
    environment: RazorpayEnvironment,
    status: 'unconfigured' | 'connected' | 'error',
    errorMessage?: string | null
  ): Promise<RazorpayConnection> {
    await this.getPool().query(
      `INSERT INTO payments.razorpay_connections
         (environment, status, last_sync_error, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (environment) DO UPDATE SET
         status           = EXCLUDED.status,
         last_sync_error  = EXCLUDED.last_sync_error,
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
      `INSERT INTO payments.razorpay_connections
         (environment, status, razorpay_account_id, razorpay_merchant_name,
          account_livemode, last_synced_at, last_sync_status, last_sync_counts,
          last_sync_error, updated_at)
       VALUES ($1, 'connected', $2, $3, $4, $5, 'succeeded', $6, NULL, NOW())
       ON CONFLICT (environment) DO UPDATE SET
         status                = 'connected',
         razorpay_account_id   = EXCLUDED.razorpay_account_id,
         razorpay_merchant_name= EXCLUDED.razorpay_merchant_name,
         account_livemode      = EXCLUDED.account_livemode,
         last_synced_at        = EXCLUDED.last_synced_at,
         last_sync_status      = 'succeeded',
         last_sync_counts      = EXCLUDED.last_sync_counts,
         last_sync_error       = NULL,
         updated_at            = NOW()`,
      [environment, accountId, merchantName, livemode, syncedAt, syncCounts]
    );
  }

  // ─── Webhook Management ─────────────────────────────────────────────────────

  async configureWebhook(
    environment: RazorpayEnvironment,
    provider: RazorpayProvider
  ): Promise<RazorpayConnection> {
    let webhookSecret = await this.getRazorpayWebhookSecret(environment);
    
    if (!webhookSecret) {
      // Auto-generate a secure random secret for Razorpay webhooks
      webhookSecret = generateSecureToken(32);
      
      const secretName = RAZORPAY_WEBHOOK_SECRET_BY_ENVIRONMENT[environment];
      await this.getPool().query(
        `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
         VALUES ($1, $2, true, true)
         ON CONFLICT (key) DO UPDATE SET
           value_ciphertext = EXCLUDED.value_ciphertext,
           is_active        = true,
           is_reserved      = true,
           updated_at       = NOW()`,
        [secretName, EncryptionManager.encrypt(webhookSecret)]
      );
    }

    const webhookUrl = `${getApiBaseUrl()}/api/payments/razorpay/${environment}/webhook`;

    // Standard Razorpay integrations do not support creating webhooks via API.
    // We generate the secret and URL locally so the user can copy them into the Razorpay Dashboard.
    await this.getPool().query(
      `UPDATE payments.razorpay_connections
       SET webhook_endpoint_id   = 'manual',
           webhook_endpoint_url  = $1,
           webhook_configured_at = NOW(),
           updated_at            = NOW()
       WHERE environment = $2`,
      [webhookUrl, environment]
    );

    logger.info('Razorpay webhook configured locally', { environment, webhookUrl });

    return this.getConnection(environment);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private normalizeConnectionRow(
    row: RazorpayConnectionRow,
    maskedKey: string | null
  ): RazorpayConnection {
    return {
      environment: row.environment,
      status: row.status,
      razorpayAccountId: row.razorpayAccountId ?? null,
      razorpayMerchantName: row.razorpayMerchantName ?? null,
      accountLivemode: row.accountLivemode ?? null,
      webhookEndpointId: row.webhookEndpointId ?? null,
      webhookEndpointUrl: row.webhookEndpointUrl ?? null,
      webhookConfiguredAt: row.webhookConfiguredAt
        ? new Date(row.webhookConfiguredAt).toISOString()
        : null,
      maskedKey,
      lastSyncedAt: row.lastSyncedAt ? new Date(row.lastSyncedAt).toISOString() : null,
      lastSyncStatus: row.lastSyncStatus ?? null,
      lastSyncError: row.lastSyncError ?? null,
      lastSyncCounts: row.lastSyncCounts ?? {},
    };
  }

  private buildUnconfiguredConnection(environment: RazorpayEnvironment): RazorpayConnection {
    return {
      environment,
      status: 'unconfigured',
      razorpayAccountId: null,
      razorpayMerchantName: null,
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
