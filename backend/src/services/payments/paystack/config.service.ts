import { createHash } from 'node:crypto';
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
import { toISOStringOrNull } from '@/utils/dates.js';
import logger from '@/utils/logger.js';
import { withPaymentSessionAdvisoryLock } from '@/services/payments/payments-advisory-lock.js';
import {
  PAYSTACK_ENVIRONMENTS,
  type PaystackEnvironment,
  type PaystackConnectionRow,
} from '@/types/payments.js';
import {
  ERROR_CODES,
  type GetPaystackWebhookSetupResponse,
  type PaystackConnection,
  type PaystackKeyConfig,
} from '@insforge/shared-schemas';

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

/**
 * One-way fingerprint of a secret key, persisted in the connection row's `raw`
 * JSONB so key changes remain detectable after the secret itself is
 * deactivated. Never store or log the raw key alongside the connection.
 */
function fingerprintPaystackSecretKey(secretKey: string): string {
  return createHash('sha256').update(secretKey).digest('hex');
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
  ): Promise<PaystackConnection> {
    return this.withEnvironmentLock(environment, async () => {
      const trimmedSecretKey = secretKey.trim();
      const trimmedPublicKey = publicKey?.trim();

      const secretKeyKey = getPaystackSecretKeyName(environment);
      const publicKeyKey = getPaystackPublicKeyName(environment);

      // The settings panel hydrates the secret key field with a masked
      // placeholder (e.g. `sk_test_****abcd`) rather than the raw value. When a
      // masked placeholder is submitted unchanged, keep the stored secret
      // instead of overwriting it with the mask.
      const existingSecretKey = await SecretService.getInstance().getSecretByKey(secretKeyKey);
      const isMaskedSubmission = trimmedSecretKey.includes('****');
      const effectiveSecretKey =
        isMaskedSubmission && existingSecretKey !== null ? existingSecretKey : trimmedSecretKey;

      validatePaystackKey(environment, effectiveSecretKey);
      if (trimmedPublicKey && !trimmedPublicKey.startsWith(`pk_${environment}_`)) {
        throw new AppError(
          `Paystack ${environment} public key must start with pk_${environment}_`,
          400,
          ERROR_CODES.PAYMENT_CONFIG_INVALID
        );
      }

      const provider = new PaystackProvider({ environment, secretKey: effectiveSecretKey });
      const account = await provider.retrieveAccount();
      // Paystack has no stable account identifier, so a secret key change is the
      // closest signal that the connection now points at different account data.
      // Compare fingerprints persisted on the connection row rather than the
      // active secret: removePaystackKeys deactivates the secret but keeps the
      // fingerprint, so re-adding a different key after removal still wipes.
      const secretKeyFingerprint = fingerprintPaystackSecretKey(effectiveSecretKey);
      const storedFingerprint = await this.getStoredSecretKeyFingerprint(environment);
      const shouldClearPaymentData =
        storedFingerprint !== null && storedFingerprint !== secretKeyFingerprint;

      const encryptedSecretKey = EncryptionManager.encrypt(effectiveSecretKey);

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
             last_sync_counts,
             raw
           )
           VALUES ('paystack', $1, 'connected', $2, $3, $4, NULL, NULL, NULL, NULL, NULL, NULL, '{}'::JSONB,
                   jsonb_build_object('secretKeyFingerprint', $6::TEXT))
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
             raw = payments.provider_connections.raw
                     || jsonb_build_object('secretKeyFingerprint', $6::TEXT),
             updated_at = NOW()`,
          [
            environment,
            account.id,
            account.accountEmail,
            account.livemode,
            shouldClearPaymentData,
            secretKeyFingerprint,
          ]
        );

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          logger.error('Failed to roll back Paystack key update', {
            environment,
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          });
        });
        throw error;
      } finally {
        client.release();
      }

      return this.getConnection(environment);
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
          // Intentionally leaves `raw` (and its secretKeyFingerprint) untouched:
          // setPaystackKeys compares fingerprints to decide whether stale payment
          // data must be wiped when keys are configured again after removal.
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
        await client.query('ROLLBACK').catch((rollbackError: unknown) => {
          logger.error('Failed to roll back Paystack key update', {
            environment,
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          });
        });
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

  async getConnection(environment: PaystackEnvironment): Promise<PaystackConnection> {
    const row = await this.getPool().query<PaystackConnectionRow>(
      `SELECT
         environment,
         status,
         provider_account_id      AS "accountId",
         account_email            AS "accountEmail",
         account_livemode         AS "accountLivemode",
         webhook_endpoint_url     AS "webhookEndpointUrl",
         webhook_configured_at    AS "webhookConfiguredAt",
         last_synced_at           AS "lastSyncedAt",
         last_sync_status         AS "lastSyncStatus",
         last_sync_error          AS "lastSyncError",
         last_sync_counts         AS "lastSyncCounts"
       FROM payments.provider_connections
       WHERE provider = 'paystack'
         AND environment = $1`,
      [environment]
    );

    if (row.rowCount === 0) {
      return this.buildUnconfiguredConnection(environment);
    }

    let maskedKey: string | null = null;
    try {
      const secretKey = await this.getPaystackSecretKey(environment);
      maskedKey = secretKey ? maskPaystackKey(secretKey) : null;
    } catch {
      // A malformed stored key must not take down the whole status endpoint:
      // report the connection without a masked key so getPaystackStatus can
      // surface the environment as errored rather than rejecting outright.
      maskedKey = null;
    }

    return this.normalizeConnectionRow(row.rows[0] as PaystackConnectionRow, maskedKey);
  }

  async getPaystackStatus(): Promise<PaystackConnection[]> {
    const environments = this.listPaystackEnvironments();
    return Promise.all(environments.map((env) => this.getConnection(env)));
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

    if (keyType === 'secret_key') {
      // Secret keys must never leave the backend in full. The dashboard only
      // needs to know one is configured and what it looks like masked; on save
      // it submits the masked placeholder unchanged and setPaystackKeys keeps
      // the stored secret.
      return {
        environment,
        keyType,
        value: null,
        hasKey: raw !== null,
        maskedKey: raw ? maskPaystackKey(raw) : null,
      };
    }

    // Public keys are safe to return raw (Stripe/Razorpay parity): the settings
    // panel hydrates and resaves them as-is.
    return {
      environment,
      keyType,
      value: raw,
      hasKey: raw !== null,
      maskedKey: null,
    };
  }

  private async getStoredSecretKeyFingerprint(
    environment: PaystackEnvironment
  ): Promise<string | null> {
    const result = await this.getPool().query(
      `SELECT raw->>'secretKeyFingerprint' AS "secretKeyFingerprint"
       FROM payments.provider_connections
       WHERE provider = 'paystack'
         AND environment = $1`,
      [environment]
    );

    const row = result.rows[0] as { secretKeyFingerprint: string | null } | undefined;
    return row?.secretKeyFingerprint ?? null;
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
  ): Promise<GetPaystackWebhookSetupResponse> {
    // The secret key doubles as the webhook HMAC key, so there is no separate
    // webhook secret to provision — only the endpoint URL to surface. Run under
    // the environment lock so a concurrent key change (which wipes webhook
    // connection fields) cannot race and leave a stale webhook endpoint.
    return this.withEnvironmentLock(environment, async () => {
      await this.createPaystackProvider(environment);
      const webhookUrl = this.getWebhookUrl(environment);

      await this.upsertManualWebhookConnection(environment, webhookUrl);

      return {
        connection: await this.getConnection(environment),
        webhookUrl,
      };
    });
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

  private normalizeConnectionRow(
    row: PaystackConnectionRow,
    maskedKey: string | null
  ): PaystackConnection {
    return {
      environment: row.environment,
      status: row.status,
      accountId: row.accountId ?? null,
      accountEmail: row.accountEmail ?? null,
      accountLivemode: row.accountLivemode ?? null,
      webhookEndpointUrl: row.webhookEndpointUrl ?? null,
      webhookConfiguredAt: toISOStringOrNull(row.webhookConfiguredAt),
      maskedKey,
      lastSyncedAt: toISOStringOrNull(row.lastSyncedAt),
      lastSyncStatus: row.lastSyncStatus ?? null,
      lastSyncError: row.lastSyncError ?? null,
      lastSyncCounts: row.lastSyncCounts ?? {},
    };
  }

  private buildUnconfiguredConnection(environment: PaystackEnvironment): PaystackConnection {
    return {
      environment,
      status: 'unconfigured',
      accountId: null,
      accountEmail: null,
      accountLivemode: null,
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
