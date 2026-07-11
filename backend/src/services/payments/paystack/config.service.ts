import type { Pool, PoolClient } from 'pg';

import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { AppError } from '@/utils/errors.js';
import {
  PaystackProvider,
  validatePaystackKey,
  maskPaystackKey,
} from '@/providers/payments/paystack.provider.js';
import { getApiBaseUrl } from '@/utils/environment.js';
import logger from '@/utils/logger.js';
import { withPaymentSessionAdvisoryLock } from '@/services/payments/payments-advisory-lock.js';
import {
  PAYSTACK_ENVIRONMENTS,
  type PaystackEnvironment,
  type PaystackConnectionRow,
} from '@/types/payments.js';
import { ERROR_CODES, type PaystackKeyConfig } from '@insforge/shared-schemas';

const PAYSTACK_SECRET_KEY_BY_ENVIRONMENT: Record<PaystackEnvironment, string> = {
  test: 'PAYSTACK_TEST_SECRET_KEY',
  live: 'PAYSTACK_LIVE_SECRET_KEY',
};

const PAYSTACK_PUBLIC_KEY_BY_ENVIRONMENT: Record<PaystackEnvironment, string> = {
  test: 'PAYSTACK_TEST_PUBLIC_KEY',
  live: 'PAYSTACK_LIVE_PUBLIC_KEY',
};

function getPaystackSecretKeyName(environment: PaystackEnvironment): string {
  return PAYSTACK_SECRET_KEY_BY_ENVIRONMENT[environment];
}

function getPaystackPublicKeyName(environment: PaystackEnvironment): string {
  return PAYSTACK_PUBLIC_KEY_BY_ENVIRONMENT[environment];
}

export class PaystackConfigService {
  private static instance: PaystackConfigService;
  private pool: Pool | null = null;

  static getInstance(): PaystackConfigService {
    if (!PaystackConfigService.instance) {
      PaystackConfigService.instance = new PaystackConfigService();
    }
    return PaystackConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  private async withEnvironmentLock<T>(
    environment: PaystackEnvironment,
    task: () => Promise<T>
  ): Promise<T> {
    return withPaymentSessionAdvisoryLock(
      this.getPool(),
      `payments_paystack_environment_${environment}`,
      task
    );
  }

  listPaystackEnvironments(): PaystackEnvironment[] {
    return [...PAYSTACK_ENVIRONMENTS];
  }

  async getPaystackSecretKey(environment: PaystackEnvironment): Promise<string | null> {
    const secretKey = await SecretService.getInstance().getSecretByKey(
      getPaystackSecretKeyName(environment)
    );
    if (!secretKey) {
      return null;
    }
    validatePaystackKey(environment, secretKey);
    return secretKey;
  }

  async getPaystackPublicKey(environment: PaystackEnvironment): Promise<string | null> {
    return SecretService.getInstance().getSecretByKey(getPaystackPublicKeyName(environment));
  }

  async setPaystackKeys(
    environment: PaystackEnvironment,
    secretKey: string,
    publicKey?: string | null
  ): Promise<PaystackConnectionRow> {
    return this.withEnvironmentLock(environment, async () => {
      const trimmedSecretKey = secretKey.trim();
      const trimmedPublicKey = publicKey?.trim();

      validatePaystackKey(environment, trimmedSecretKey);
      if (trimmedPublicKey && !trimmedPublicKey.startsWith(`pk_${environment}_`)) {
        throw new AppError(
          `Paystack ${environment} public key must start with pk_${environment}_`,
          400,
          ERROR_CODES.PAYMENT_CONFIG_INVALID
        );
      }

      const secretKeyKey = getPaystackSecretKeyName(environment);
      const publicKeyKey = getPaystackPublicKeyName(environment);
      const secretService = SecretService.getInstance();

      const existingSecretKey = await secretService.getSecretByKey(secretKeyKey);

      const provider = new PaystackProvider({ environment, secretKey: trimmedSecretKey });
      const account = await provider.retrieveAccount();
      // Paystack has no stable account identifier, so a secret key change is the
      // closest signal that the connection now points at different account data.
      const shouldClearPaymentData =
        existingSecretKey !== null && existingSecretKey !== trimmedSecretKey;

      const encryptedSecretKey = EncryptionManager.encrypt(trimmedSecretKey);

      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');

        if (shouldClearPaymentData) {
          await this.clearPaymentData(client, environment);
          logger.info('Cleared Paystack payment data after secret key change', {
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
          [secretKeyKey, encryptedSecretKey]
        );

        if (trimmedPublicKey) {
          const encryptedPublicKey = EncryptionManager.encrypt(trimmedPublicKey);
          await client.query(
            `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
             VALUES ($1, $2, true, true)
             ON CONFLICT (key) DO UPDATE SET
               value_ciphertext = EXCLUDED.value_ciphertext,
               is_active        = true,
               is_reserved      = true,
               updated_at       = NOW()`,
            [publicKeyKey, encryptedPublicKey]
          );
        } else if (publicKey === null) {
          await client.query(
            `UPDATE system.secrets SET is_active = false, updated_at = NOW()
             WHERE key = $1 AND is_active = true`,
            [publicKeyKey]
          );
        }

        await client.query(
          `INSERT INTO payments.provider_connections (
             provider,
             environment,
             status,
             provider_account_id,
             account_email,
             account_livemode,
             webhook_endpoint_id,
             webhook_endpoint_url,
             webhook_configured_at,
             last_synced_at,
             last_sync_status,
             last_sync_error,
             last_sync_counts
           )
           VALUES ('paystack', $1, 'connected', $2, $3, $4, NULL, NULL, NULL, NULL, NULL, NULL, '{}'::JSONB)
           ON CONFLICT (provider, environment) DO UPDATE SET
             status = 'connected',
             provider_account_id = EXCLUDED.provider_account_id,
             account_email = EXCLUDED.account_email,
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
          [environment, account.id, account.accountEmail, account.livemode, shouldClearPaymentData]
        );

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      return this.requireConnection(environment);
    });
  }

  async removePaystackKeys(environment: PaystackEnvironment): Promise<void> {
    return this.withEnvironmentLock(environment, async () => {
      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        const resultSecretKey = await client.query(
          `UPDATE system.secrets SET is_active = false, updated_at = NOW()
           WHERE key = $1 AND is_active = true`,
          [getPaystackSecretKeyName(environment)]
        );
        const resultPublicKey = await client.query(
          `UPDATE system.secrets SET is_active = false, updated_at = NOW()
           WHERE key = $1 AND is_active = true`,
          [getPaystackPublicKeyName(environment)]
        );

        const removed = (resultSecretKey.rowCount ?? 0) > 0 || (resultPublicKey.rowCount ?? 0) > 0;
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
             WHERE provider = 'paystack'
               AND environment = $1`,
            [environment, `Paystack ${environment} keys are not configured`]
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async createPaystackProvider(environment: PaystackEnvironment): Promise<PaystackProvider> {
    const secretKey = await this.getPaystackSecretKey(environment);

    if (!secretKey) {
      throw new AppError(
        `Paystack ${environment} keys are not configured`,
        400,
        ERROR_CODES.PAYMENT_CONFIG_NOT_FOUND
      );
    }

    return new PaystackProvider({ environment, secretKey });
  }

  async getConnection(environment: PaystackEnvironment): Promise<PaystackConnectionRow | null> {
    const result = await this.getPool().query<PaystackConnectionRow>(
      `SELECT
         id,
         environment,
         status,
         provider_account_id      AS "accountId",
         account_email            AS "accountEmail",
         account_livemode         AS "accountLivemode",
         webhook_endpoint_url     AS "webhookEndpointUrl",
         (SELECT s.id FROM system.secrets s
           WHERE s.key = $2 AND s.is_active = true) AS "secretKeyId",
         (SELECT s.id FROM system.secrets s
           WHERE s.key = $3 AND s.is_active = true) AS "publicKeyId",
         webhook_configured_at    AS "webhookConfiguredAt",
         last_synced_at           AS "lastSyncedAt",
         last_sync_status         AS "lastSyncStatus",
         last_sync_error          AS "lastSyncError",
         last_sync_counts         AS "lastSyncCounts",
         raw,
         created_at               AS "createdAt",
         updated_at               AS "updatedAt"
       FROM payments.provider_connections
       WHERE provider = 'paystack'
         AND environment = $1`,
      [environment, getPaystackSecretKeyName(environment), getPaystackPublicKeyName(environment)]
    );

    if (result.rowCount === 0) {
      return null;
    }

    return result.rows[0] as PaystackConnectionRow;
  }

  private async requireConnection(
    environment: PaystackEnvironment
  ): Promise<PaystackConnectionRow> {
    const connection = await this.getConnection(environment);
    if (!connection) {
      throw new AppError(
        `Paystack ${environment} connection was not found`,
        404,
        ERROR_CODES.PAYMENT_CONFIG_NOT_FOUND
      );
    }
    return connection;
  }

  async getPaystackStatus(): Promise<PaystackConnectionRow[]> {
    const environments = this.listPaystackEnvironments();
    const connections = await Promise.all(
      environments.map((environment) => this.getConnection(environment))
    );
    return connections.map(
      (connection, index) => connection ?? this.buildUnconfiguredConnectionRow(environments[index])
    );
  }

  async getKeyConfig(): Promise<PaystackKeyConfig[]> {
    const environments = this.listPaystackEnvironments();
    return Promise.all(
      environments.flatMap((env) => [
        this.buildKeyConfig(env, 'secret_key', getPaystackSecretKeyName(env)),
        this.buildKeyConfig(env, 'public_key', getPaystackPublicKeyName(env)),
      ])
    );
  }

  private async buildKeyConfig(
    environment: PaystackEnvironment,
    keyType: PaystackKeyConfig['keyType'],
    secretName: string
  ): Promise<PaystackKeyConfig> {
    const raw = await SecretService.getInstance().getSecretByKey(secretName);
    return {
      environment,
      keyType,
      value: raw ? maskPaystackKey(raw) : null,
    };
  }

  private async clearPaymentData(
    client: PoolClient,
    environment: PaystackEnvironment
  ): Promise<void> {
    await client.query('DELETE FROM payments.paystack_transactions WHERE environment = $1', [
      environment,
    ]);
    await client.query(
      'DELETE FROM payments.transactions WHERE provider = $1 AND environment = $2',
      ['paystack', environment]
    );
    await client.query('DELETE FROM payments.customers WHERE environment = $1 AND provider = $2', [
      environment,
      'paystack',
    ]);
    await client.query(
      'DELETE FROM payments.customer_mappings WHERE environment = $1 AND provider = $2',
      [environment, 'paystack']
    );
    await client.query(
      'DELETE FROM payments.webhook_events WHERE environment = $1 AND provider = $2',
      [environment, 'paystack']
    );
  }

  async getWebhookSetup(
    environment: PaystackEnvironment
  ): Promise<{ connection: PaystackConnectionRow; webhookUrl: string }> {
    // The secret key doubles as the webhook HMAC key, so there is no separate
    // webhook secret to provision — only the endpoint URL to surface.
    await this.createPaystackProvider(environment);
    const webhookUrl = this.getWebhookUrl(environment);

    await this.upsertManualWebhookConnection(environment, webhookUrl);

    return {
      connection: await this.requireConnection(environment),
      webhookUrl,
    };
  }

  private getWebhookUrl(environment: PaystackEnvironment): string {
    return `${getApiBaseUrl().replace(/\/+$/, '')}/api/webhooks/paystack/${environment}`;
  }

  private async upsertManualWebhookConnection(
    environment: PaystackEnvironment,
    webhookUrl: string
  ): Promise<void> {
    await this.getPool().query(
      `INSERT INTO payments.provider_connections
         (provider, environment, webhook_endpoint_id, webhook_endpoint_url, webhook_configured_at, updated_at)
       VALUES ('paystack', $1, 'manual', $2, NOW(), NOW())
       ON CONFLICT (provider, environment) DO UPDATE SET
         webhook_endpoint_id   = 'manual',
         webhook_endpoint_url  = EXCLUDED.webhook_endpoint_url,
         webhook_configured_at = EXCLUDED.webhook_configured_at,
         updated_at            = EXCLUDED.updated_at`,
      [environment, webhookUrl]
    );

    logger.info('Paystack webhook setup values prepared', {
      environment,
      webhookUrl,
    });
  }

  private buildUnconfiguredConnectionRow(environment: PaystackEnvironment): PaystackConnectionRow {
    const now = new Date().toISOString();
    return {
      // Placeholder for environments without a persisted connection row.
      id: '',
      environment,
      status: 'unconfigured',
      accountId: null,
      accountEmail: null,
      accountLivemode: null,
      webhookEndpointUrl: null,
      secretKeyId: null,
      publicKeyId: null,
      webhookConfiguredAt: null,
      lastSyncedAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
      lastSyncCounts: {},
      raw: {},
      createdAt: now,
      updatedAt: now,
    };
  }
}
