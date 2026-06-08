import type { Pool, PoolClient } from 'pg';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/utils/errors.js';
import {
  maskStripeKey,
  StripeProvider,
  validateStripeSecretKey,
} from '@/providers/payments/stripe.provider.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import {
  STRIPE_MANAGED_WEBHOOK_EVENTS,
  STRIPE_MANAGED_WEBHOOK_METADATA,
  getStripeSecretKeyName,
  getStripeWebhookSecretName,
} from '@/services/payments/stripe/constants.js';
import { getStripeObjectId, normalizeStripeDecimal } from '@/services/payments/helpers.js';
import { toISOStringOrNull } from '@/utils/dates.js';
import { withPaymentSessionAdvisoryLock } from '@/services/payments/payments-advisory-lock.js';
import logger from '@/utils/logger.js';
import { getApiBaseUrl } from '@/utils/environment.js';
import {
  STRIPE_ENVIRONMENTS,
  type StripeAccount,
  type StripeConnectionRow,
  type StripeEnvironment,
  type StripePrice,
  type StripeProduct,
  type StripeSyncSnapshot,
  type StripeWebhookEndpoint,
} from '@/types/payments.js';
import {
  ERROR_CODES,
  type GetStripeConfigResponse,
  type GetStripeStatusResponse,
  type StripeConnection,
} from '@insforge/shared-schemas';

export interface ManagedStripeWebhookSetup {
  endpointId: string;
  endpointUrl: string;
  secret: string;
}

type SyncStripeAfterKeyChange = (
  environment: StripeEnvironment,
  provider: StripeProvider
) => Promise<void>;

export class StripeConfigService {
  private static instance: StripeConfigService;
  private pool: Pool | null = null;

  static getInstance(): StripeConfigService {
    if (!StripeConfigService.instance) {
      StripeConfigService.instance = new StripeConfigService();
    }

    return StripeConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  private async withEnvironmentLock<T>(
    environment: StripeEnvironment,
    task: () => Promise<T>
  ): Promise<T> {
    const lockName = `payments_environment_${environment}`;
    return withPaymentSessionAdvisoryLock(this.getPool(), lockName, task);
  }

  listStripeEnvironments(): StripeEnvironment[] {
    return [...STRIPE_ENVIRONMENTS];
  }

  async getConfig(): Promise<GetStripeConfigResponse> {
    const environments = this.listStripeEnvironments();
    const keys = await Promise.all(
      environments.map((environment) => this.getStripeKeyConfig(environment))
    );

    return { keys };
  }

  async getStripeSecretKey(environment: StripeEnvironment): Promise<string | null> {
    const secretKey = await SecretService.getInstance().getSecretByKey(
      getStripeSecretKeyName(environment)
    );

    if (!secretKey) {
      return null;
    }

    validateStripeSecretKey(environment, secretKey);
    return secretKey;
  }

  async createStripeProvider(environment: StripeEnvironment): Promise<StripeProvider> {
    const secretKey = await this.getStripeSecretKey(environment);

    if (!secretKey) {
      throw new AppError(
        `${getStripeSecretKeyName(environment)} is not configured`,
        400,
        ERROR_CODES.PAYMENT_CONFIG_INVALID
      );
    }

    return new StripeProvider(secretKey, environment);
  }

  async setStripeSecretKey(
    environment: StripeEnvironment,
    secretKey: string,
    syncAfterKeyChange: SyncStripeAfterKeyChange
  ): Promise<void> {
    await this.withEnvironmentLock(environment, async () => {
      const trimmedSecretKey = secretKey.trim();
      validateStripeSecretKey(environment, trimmedSecretKey);

      const existingSecretKey = await this.getStripeSecretKey(environment);
      const currentStripeAccountId = await this.getCurrentStripeAccountId(environment);
      if (existingSecretKey === trimmedSecretKey && currentStripeAccountId) {
        return;
      }

      const provider = new StripeProvider(trimmedSecretKey, environment);
      const account = await provider.retrieveAccount();
      const encryptedValue = EncryptionManager.encrypt(trimmedSecretKey);
      const sameConfiguredStripeAccount =
        !!existingSecretKey && currentStripeAccountId === account.id;

      if (sameConfiguredStripeAccount) {
        await this.persistSameAccountStripeSecretKey(environment, encryptedValue, account);
        return;
      }

      const shouldClearPaymentData = currentStripeAccountId !== account.id;
      const webhookSetup = await this.tryRecreateManagedStripeWebhook(provider, environment);

      await this.persistStripeSecretKey(
        environment,
        encryptedValue,
        account,
        shouldClearPaymentData,
        webhookSetup
      );

      await syncAfterKeyChange(environment, provider);
    });
  }

  async removeStripeSecretKey(environment: StripeEnvironment): Promise<boolean> {
    return this.withEnvironmentLock(environment, async () =>
      this.removeStripeSecretKeyUnlocked(environment)
    );
  }

  async seedStripeKeysFromEnv(syncAfterKeyChange: SyncStripeAfterKeyChange): Promise<void> {
    for (const environment of STRIPE_ENVIRONMENTS) {
      const secretKeyName = getStripeSecretKeyName(environment);
      const secretKey = process.env[secretKeyName]?.trim();

      if (!secretKey) {
        continue;
      }

      try {
        const existingSecretKey = await SecretService.getInstance().getSecretByKey(secretKeyName);
        if (existingSecretKey) {
          continue;
        }

        await this.setStripeSecretKey(environment, secretKey, syncAfterKeyChange);
        logger.info(`✅ ${secretKeyName} secret initialized`);
      } catch (error) {
        logger.warn(`Failed to initialize ${secretKeyName}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async getStatus(): Promise<GetStripeStatusResponse> {
    const environments = this.listStripeEnvironments();
    const result = await this.getPool().query(
      `SELECT
         environment,
         status,
         provider_account_id AS "accountId",
         account_email AS "accountEmail",
         account_livemode AS "accountLivemode",
         webhook_endpoint_id AS "webhookEndpointId",
         webhook_endpoint_url AS "webhookEndpointUrl",
         webhook_configured_at AS "webhookConfiguredAt",
         last_synced_at AS "lastSyncedAt",
         last_sync_status AS "lastSyncStatus",
         last_sync_error AS "lastSyncError",
         last_sync_counts AS "lastSyncCounts"
       FROM payments.provider_connections
       WHERE provider = 'stripe'
       ORDER BY environment`
    );

    const rowsByEnvironment = new Map<StripeEnvironment, StripeConnectionRow>(
      (result.rows as StripeConnectionRow[]).map((row) => [row.environment, row])
    );

    const connections = await Promise.all(
      environments.map(async (environment) => {
        const keyConfig = await this.getStripeKeyConfig(environment);
        return this.normalizeConnectionRow(
          rowsByEnvironment.get(environment) ?? this.createEmptyConnection(environment),
          keyConfig.maskedKey
        );
      })
    );

    return { connections };
  }

  async getStripeWebhookSecret(environment: StripeEnvironment): Promise<string | null> {
    return SecretService.getInstance().getSecretByKey(getStripeWebhookSecretName(environment));
  }

  async getCurrentStripeAccountId(environment: StripeEnvironment): Promise<string | null> {
    const result = await this.getPool().query(
      `SELECT provider_account_id AS "accountId"
       FROM payments.provider_connections
       WHERE provider = 'stripe'
         AND environment = $1`,
      [environment]
    );

    const row = result.rows[0] as { accountId: string | null } | undefined;
    return row?.accountId ?? null;
  }

  async getConnection(environment: StripeEnvironment): Promise<StripeConnection> {
    const result = await this.getPool().query(
      `SELECT
         environment,
         status,
         provider_account_id AS "accountId",
         account_email AS "accountEmail",
         account_livemode AS "accountLivemode",
         webhook_endpoint_id AS "webhookEndpointId",
         webhook_endpoint_url AS "webhookEndpointUrl",
         webhook_configured_at AS "webhookConfiguredAt",
         last_synced_at AS "lastSyncedAt",
         last_sync_status AS "lastSyncStatus",
         last_sync_error AS "lastSyncError",
         last_sync_counts AS "lastSyncCounts"
       FROM payments.provider_connections
       WHERE provider = 'stripe'
         AND environment = $1`,
      [environment]
    );

    const keyConfig = await this.getStripeKeyConfig(environment);
    return this.normalizeConnectionRow(
      (result.rows[0] as StripeConnectionRow | undefined) ??
        this.createEmptyConnection(environment),
      keyConfig.maskedKey
    );
  }

  async configureManagedStripeWebhook(environment: StripeEnvironment): Promise<StripeConnection> {
    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.createStripeProvider(environment);
      const account = await provider.retrieveAccount();
      const currentStripeAccountId = await this.getCurrentStripeAccountId(environment);
      const webhookSetup = await this.recreateManagedStripeWebhook(provider, environment);

      return this.persistManagedStripeWebhookConfiguration(
        environment,
        account,
        webhookSetup,
        currentStripeAccountId !== account.id
      );
    });
  }

  async recordConnectionStatus(
    environment: StripeEnvironment,
    status: 'unconfigured' | 'error',
    error: string
  ): Promise<StripeConnection> {
    const result = await this.getPool().query(
      `INSERT INTO payments.provider_connections (
         provider,
         environment,
         status,
         last_sync_status,
         last_sync_error,
         last_sync_counts
       )
       VALUES ('stripe', $1, $2, 'failed', $3, '{}'::JSONB)
       ON CONFLICT (provider, environment) DO UPDATE SET
         status = EXCLUDED.status,
         last_sync_status = 'failed',
         last_sync_error = EXCLUDED.last_sync_error,
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
         updated_at = NOW()
       RETURNING
         environment,
         status,
         provider_account_id AS "accountId",
         account_email AS "accountEmail",
         account_livemode AS "accountLivemode",
         webhook_endpoint_id AS "webhookEndpointId",
         webhook_endpoint_url AS "webhookEndpointUrl",
         webhook_configured_at AS "webhookConfiguredAt",
         last_synced_at AS "lastSyncedAt",
         last_sync_status AS "lastSyncStatus",
         last_sync_error AS "lastSyncError",
         last_sync_counts AS "lastSyncCounts"`,
      [environment, status, error]
    );

    const keyConfig = await this.getStripeKeyConfig(environment);
    return this.normalizeConnectionRow(result.rows[0] as StripeConnectionRow, keyConfig.maskedKey);
  }

  async tryRecreateManagedStripeWebhook(
    provider: StripeProvider,
    environment: StripeEnvironment
  ): Promise<ManagedStripeWebhookSetup | null> {
    try {
      return await this.recreateManagedStripeWebhook(provider, environment);
    } catch (error) {
      logger.warn('Stripe managed webhook setup skipped', {
        environment,
        endpointUrl: this.getManagedStripeWebhookUrl(environment),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async upsertProducts(
    client: PoolClient,
    environment: StripeEnvironment,
    products: StripeProduct[],
    syncStartedAt: Date
  ): Promise<void> {
    for (const product of products) {
      await client.query(
        `INSERT INTO payments.stripe_products (
           environment,
           product_id,
           name,
           description,
           active,
           default_price_id,
           metadata,
           raw,
           synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (environment, product_id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           active = EXCLUDED.active,
           default_price_id = EXCLUDED.default_price_id,
           metadata = EXCLUDED.metadata,
           raw = EXCLUDED.raw,
           synced_at = EXCLUDED.synced_at,
           updated_at = NOW()`,
        [
          environment,
          product.id,
          product.name,
          product.description ?? null,
          product.active,
          getStripeObjectId(product.default_price),
          product.metadata ?? {},
          product,
          syncStartedAt,
        ]
      );
    }
  }

  private async upsertPrices(
    client: PoolClient,
    environment: StripeEnvironment,
    prices: StripePrice[],
    syncStartedAt: Date
  ): Promise<void> {
    for (const price of prices) {
      await client.query(
        `INSERT INTO payments.stripe_prices (
           environment,
           price_id,
           product_id,
           active,
           currency,
           unit_amount,
           unit_amount_decimal,
           type,
           lookup_key,
           billing_scheme,
           tax_behavior,
           recurring_interval,
           recurring_interval_count,
           metadata,
           raw,
           synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (environment, price_id) DO UPDATE SET
           product_id = EXCLUDED.product_id,
           active = EXCLUDED.active,
           currency = EXCLUDED.currency,
           unit_amount = EXCLUDED.unit_amount,
           unit_amount_decimal = EXCLUDED.unit_amount_decimal,
           type = EXCLUDED.type,
           lookup_key = EXCLUDED.lookup_key,
           billing_scheme = EXCLUDED.billing_scheme,
           tax_behavior = EXCLUDED.tax_behavior,
           recurring_interval = EXCLUDED.recurring_interval,
           recurring_interval_count = EXCLUDED.recurring_interval_count,
           metadata = EXCLUDED.metadata,
           raw = EXCLUDED.raw,
           synced_at = EXCLUDED.synced_at,
           updated_at = NOW()`,
        [
          environment,
          price.id,
          getStripeObjectId(price.product),
          price.active,
          price.currency,
          price.unit_amount ?? null,
          normalizeStripeDecimal(price.unit_amount_decimal),
          price.type,
          price.lookup_key ?? null,
          price.billing_scheme ?? null,
          price.tax_behavior ?? null,
          price.recurring?.interval ?? null,
          price.recurring?.interval_count ?? null,
          price.metadata ?? {},
          price,
          syncStartedAt,
        ]
      );
    }
  }

  private async deleteMissingRows(
    client: PoolClient,
    environment: StripeEnvironment,
    productIds: string[],
    priceIds: string[]
  ): Promise<void> {
    await client.query(
      `DELETE FROM payments.stripe_prices
       WHERE environment = $1
         AND NOT (price_id = ANY($2::TEXT[]))`,
      [environment, priceIds]
    );

    await client.query(
      `DELETE FROM payments.stripe_products
       WHERE environment = $1
         AND NOT (product_id = ANY($2::TEXT[]))`,
      [environment, productIds]
    );
  }

  async writeSnapshot(
    environment: StripeEnvironment,
    snapshot: StripeSyncSnapshot,
    syncStartedAt: Date,
    clearSyncedData = false,
    webhookSetup: ManagedStripeWebhookSetup | null = null
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `payments_sync_${environment}`,
      ]);

      if (clearSyncedData) {
        await this.clearPaymentData(client, environment);
        await this.persistManagedStripeWebhookSecret(client, environment, webhookSetup);
        logger.info('Cleared synced Stripe payment data during catalog sync after account change', {
          environment,
        });
      }

      await this.upsertConnection(client, environment, snapshot, clearSyncedData, webhookSetup);
      await this.upsertProducts(client, environment, snapshot.products, syncStartedAt);
      await this.upsertPrices(client, environment, snapshot.prices, syncStartedAt);
      await this.deleteMissingRows(
        client,
        environment,
        snapshot.products.map((product) => product.id),
        snapshot.prices.map((price) => price.id)
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async removeStripeSecretKeyUnlocked(environment: StripeEnvironment): Promise<boolean> {
    await this.deleteManagedStripeWebhookForStoredKey(environment);

    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE system.secrets
         SET is_active = false,
             updated_at = NOW()
         WHERE key = $1
           AND is_active = true`,
        [getStripeSecretKeyName(environment)]
      );

      const removed = (result.rowCount ?? 0) > 0;
      if (removed) {
        await client.query(
          `UPDATE system.secrets
           SET is_active = false,
               updated_at = NOW()
           WHERE key = $1
             AND is_active = true`,
          [getStripeWebhookSecretName(environment)]
        );
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
           WHERE provider = 'stripe'
             AND environment = $1`,
          [environment, `${getStripeSecretKeyName(environment)} is not configured`]
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

  private async deleteManagedStripeWebhookForStoredKey(
    environment: StripeEnvironment
  ): Promise<void> {
    const secretKey = await SecretService.getInstance().getSecretByKey(
      getStripeSecretKeyName(environment)
    );

    if (!secretKey) {
      return;
    }

    try {
      validateStripeSecretKey(environment, secretKey);
      const provider = new StripeProvider(secretKey, environment);
      await this.deleteManagedStripeWebhookEndpoints(provider, environment);
    } catch (error) {
      logger.warn('Failed to delete managed Stripe webhook before key removal', {
        environment,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async clearPaymentData(
    client: PoolClient,
    environment: StripeEnvironment
  ): Promise<void> {
    await client.query('DELETE FROM payments.stripe_subscription_items WHERE environment = $1', [
      environment,
    ]);
    await client.query('DELETE FROM payments.stripe_subscriptions WHERE environment = $1', [
      environment,
    ]);
    await client.query(
      'DELETE FROM payments.transactions WHERE provider = $1 AND environment = $2',
      ['stripe', environment]
    );
    await client.query('DELETE FROM payments.stripe_checkout_sessions WHERE environment = $1', [
      environment,
    ]);
    await client.query(
      'DELETE FROM payments.stripe_customer_portal_sessions WHERE environment = $1',
      [environment]
    );
    await client.query('DELETE FROM payments.customers WHERE environment = $1 AND provider = $2', [
      environment,
      'stripe',
    ]);
    await client.query(
      'DELETE FROM payments.customer_mappings WHERE environment = $1 AND provider = $2',
      [environment, 'stripe']
    );
    await client.query(
      'DELETE FROM payments.webhook_events WHERE environment = $1 AND provider = $2',
      [environment, 'stripe']
    );
    await client.query('DELETE FROM payments.stripe_prices WHERE environment = $1', [environment]);
    await client.query('DELETE FROM payments.stripe_products WHERE environment = $1', [
      environment,
    ]);
  }

  private getManagedStripeWebhookUrl(environment: StripeEnvironment): string {
    const baseUrl = getApiBaseUrl().replace(/\/+$/, '');
    return `${baseUrl}/api/webhooks/stripe/${environment}`;
  }

  private async recreateManagedStripeWebhook(
    provider: StripeProvider,
    environment: StripeEnvironment
  ): Promise<ManagedStripeWebhookSetup> {
    const endpointUrl = this.getManagedStripeWebhookUrl(environment);
    await this.deleteManagedStripeWebhookEndpoints(provider, environment);

    const createdEndpoint = await provider.createWebhookEndpoint({
      url: endpointUrl,
      enabledEvents: [...STRIPE_MANAGED_WEBHOOK_EVENTS],
      metadata: {
        ...STRIPE_MANAGED_WEBHOOK_METADATA,
        insforge_environment: environment,
        insforge_endpoint_path: `/api/webhooks/stripe/${environment}`,
        insforge_endpoint_url: endpointUrl,
      },
    });

    if (!createdEndpoint.secret) {
      throw new AppError(
        'Stripe did not return a webhook signing secret for the managed endpoint',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    return {
      endpointId: createdEndpoint.id,
      endpointUrl,
      secret: createdEndpoint.secret,
    };
  }

  private async deleteManagedStripeWebhookEndpoints(
    provider: StripeProvider,
    environment: StripeEnvironment
  ): Promise<void> {
    const endpoints = await provider.listWebhookEndpoints();
    const managedEndpoints = endpoints.filter((endpoint) =>
      this.isManagedStripeWebhookEndpoint(endpoint, environment)
    );

    for (const endpoint of managedEndpoints) {
      try {
        await provider.deleteWebhookEndpoint(endpoint.id);
      } catch (error) {
        logger.warn('Failed to delete existing InsForge-managed Stripe webhook endpoint', {
          environment,
          webhookEndpointId: endpoint.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private isManagedStripeWebhookEndpoint(
    endpoint: StripeWebhookEndpoint,
    environment: StripeEnvironment
  ): boolean {
    return (
      endpoint.metadata?.managed_by === STRIPE_MANAGED_WEBHOOK_METADATA.managed_by &&
      endpoint.metadata?.insforge_webhook === STRIPE_MANAGED_WEBHOOK_METADATA.insforge_webhook &&
      endpoint.metadata?.insforge_environment === environment
    );
  }

  private async getStripeKeyConfig(environment: StripeEnvironment) {
    const secretKey = await this.getStripeSecretKey(environment);

    return {
      environment,
      hasKey: !!secretKey,
      maskedKey: secretKey ? maskStripeKey(secretKey) : null,
    };
  }

  private async persistSameAccountStripeSecretKey(
    environment: StripeEnvironment,
    encryptedValue: string,
    account: StripeAccount
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
         VALUES ($1, $2, true, true)
         ON CONFLICT (key) DO UPDATE SET
           value_ciphertext = EXCLUDED.value_ciphertext,
           is_active = true,
           is_reserved = true,
           updated_at = NOW()`,
        [getStripeSecretKeyName(environment), encryptedValue]
      );

      await client.query(
        `INSERT INTO payments.provider_connections (
           provider,
           environment,
           provider_account_id,
           account_email,
           account_livemode,
           status,
           raw
         )
         VALUES ('stripe', $1, $2, $3, $4, 'connected', $5)
         ON CONFLICT (provider, environment) DO UPDATE SET
             provider_account_id = EXCLUDED.provider_account_id,
             account_email = EXCLUDED.account_email,
             account_livemode = EXCLUDED.account_livemode,
             status = 'connected',
             raw = EXCLUDED.raw,
             updated_at = NOW()
        `,
        [environment, account.id, account.email ?? null, environment === 'live', account]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async persistStripeSecretKey(
    environment: StripeEnvironment,
    encryptedValue: string,
    account: StripeAccount,
    clearSyncedData: boolean,
    webhookSetup: ManagedStripeWebhookSetup | null
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      if (clearSyncedData) {
        await this.clearPaymentData(client, environment);
        logger.info('Cleared synced Stripe payment data after account key change', { environment });
      }

      await client.query(
        `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
         VALUES ($1, $2, true, true)
         ON CONFLICT (key) DO UPDATE SET
           value_ciphertext = EXCLUDED.value_ciphertext,
           is_active = true,
           is_reserved = true,
           updated_at = NOW()`,
        [getStripeSecretKeyName(environment), encryptedValue]
      );

      await this.persistManagedStripeWebhookSecret(client, environment, webhookSetup);

      const webhookEndpointId = webhookSetup?.endpointId ?? null;
      const webhookEndpointUrl = webhookSetup?.endpointUrl ?? null;

      await client.query(
        `INSERT INTO payments.provider_connections (
           provider,
           environment,
           provider_account_id,
           account_email,
           account_livemode,
           status,
           webhook_endpoint_id,
           webhook_endpoint_url,
           webhook_configured_at,
           last_synced_at,
           last_sync_status,
           last_sync_error,
           last_sync_counts,
           raw
         )
         VALUES (
           'stripe',
           $1,
           $2,
           $3,
           $4,
           'connected',
           $5,
           $6,
           CASE WHEN $5::TEXT IS NULL THEN NULL ELSE NOW() END,
           NULL,
           NULL,
           NULL,
           '{}'::JSONB,
           $7
         )
         ON CONFLICT (provider, environment) DO UPDATE SET
           provider_account_id = EXCLUDED.provider_account_id,
           account_email = EXCLUDED.account_email,
           account_livemode = EXCLUDED.account_livemode,
           status = 'connected',
           webhook_endpoint_id = EXCLUDED.webhook_endpoint_id,
           webhook_endpoint_url = EXCLUDED.webhook_endpoint_url,
           webhook_configured_at = EXCLUDED.webhook_configured_at,
           last_synced_at = CASE
             WHEN $8 THEN NULL
             ELSE payments.provider_connections.last_synced_at
           END,
           last_sync_status = CASE
             WHEN $8 THEN NULL
             ELSE payments.provider_connections.last_sync_status
           END,
           last_sync_error = NULL,
           last_sync_counts = CASE
             WHEN $8 THEN '{}'::JSONB
             ELSE payments.provider_connections.last_sync_counts
           END,
           raw = EXCLUDED.raw,
           updated_at = NOW()`,
        [
          environment,
          account.id,
          account.email ?? null,
          environment === 'live',
          webhookEndpointId,
          webhookEndpointUrl,
          account,
          clearSyncedData,
        ]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async persistManagedStripeWebhookConfiguration(
    environment: StripeEnvironment,
    account: StripeAccount,
    webhookSetup: ManagedStripeWebhookSetup,
    clearSyncedData: boolean
  ): Promise<StripeConnection> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      if (clearSyncedData) {
        await this.clearPaymentData(client, environment);
        logger.info(
          'Cleared synced Stripe payment data during webhook configuration after account change',
          {
            environment,
          }
        );
      }

      await this.persistManagedStripeWebhookSecret(client, environment, webhookSetup);

      const result = await client.query(
        `INSERT INTO payments.provider_connections (
           provider,
           environment,
           provider_account_id,
           account_email,
           account_livemode,
           status,
           webhook_endpoint_id,
           webhook_endpoint_url,
           webhook_configured_at,
           raw
         )
         VALUES (
           'stripe',
           $1,
           $2,
           $3,
           $4,
           'connected',
           $5,
           $6,
           NOW(),
           $7
         )
         ON CONFLICT (provider, environment) DO UPDATE SET
           provider_account_id = EXCLUDED.provider_account_id,
           account_email = EXCLUDED.account_email,
           account_livemode = EXCLUDED.account_livemode,
           status = 'connected',
           webhook_endpoint_id = EXCLUDED.webhook_endpoint_id,
           webhook_endpoint_url = EXCLUDED.webhook_endpoint_url,
           webhook_configured_at = EXCLUDED.webhook_configured_at,
           last_synced_at = CASE
             WHEN $8 THEN NULL
             ELSE payments.provider_connections.last_synced_at
           END,
           last_sync_status = CASE
             WHEN $8 THEN NULL
             ELSE payments.provider_connections.last_sync_status
           END,
           last_sync_error = CASE
             WHEN $8 THEN NULL
             ELSE payments.provider_connections.last_sync_error
           END,
           last_sync_counts = CASE
             WHEN $8 THEN '{}'::JSONB
             ELSE payments.provider_connections.last_sync_counts
           END,
           raw = EXCLUDED.raw,
           updated_at = NOW()
         RETURNING
           environment,
           status,
           provider_account_id AS "accountId",
           account_email AS "accountEmail",
           account_livemode AS "accountLivemode",
           webhook_endpoint_id AS "webhookEndpointId",
           webhook_endpoint_url AS "webhookEndpointUrl",
           webhook_configured_at AS "webhookConfiguredAt",
           last_synced_at AS "lastSyncedAt",
           last_sync_status AS "lastSyncStatus",
           last_sync_error AS "lastSyncError",
           last_sync_counts AS "lastSyncCounts"`,
        [
          environment,
          account.id,
          account.email ?? null,
          environment === 'live',
          webhookSetup.endpointId,
          webhookSetup.endpointUrl,
          account,
          clearSyncedData,
        ]
      );

      await client.query('COMMIT');

      const keyConfig = await this.getStripeKeyConfig(environment);
      return this.normalizeConnectionRow(
        result.rows[0] as StripeConnectionRow,
        keyConfig.maskedKey
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async persistManagedStripeWebhookSecret(
    client: PoolClient,
    environment: StripeEnvironment,
    webhookSetup: ManagedStripeWebhookSetup | null
  ): Promise<void> {
    if (webhookSetup) {
      await client.query(
        `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
         VALUES ($1, $2, true, true)
         ON CONFLICT (key) DO UPDATE SET
           value_ciphertext = EXCLUDED.value_ciphertext,
           is_active = true,
           is_reserved = true,
           updated_at = NOW()`,
        [getStripeWebhookSecretName(environment), EncryptionManager.encrypt(webhookSetup.secret)]
      );
      return;
    }

    await client.query(
      `UPDATE system.secrets
       SET is_active = false,
           updated_at = NOW()
      WHERE key = $1
         AND is_active = true`,
      [getStripeWebhookSecretName(environment)]
    );
  }

  private async upsertConnection(
    client: PoolClient,
    environment: StripeEnvironment,
    snapshot: StripeSyncSnapshot,
    resetManagedWebhook = false,
    webhookSetup: ManagedStripeWebhookSetup | null = null
  ): Promise<void> {
    const webhookEndpointId = webhookSetup?.endpointId ?? null;
    const webhookEndpointUrl = webhookSetup?.endpointUrl ?? null;

    await client.query(
      `INSERT INTO payments.provider_connections (
         provider,
         environment,
         provider_account_id,
         account_email,
         account_livemode,
         status,
         webhook_endpoint_id,
         webhook_endpoint_url,
         webhook_configured_at,
         last_synced_at,
         last_sync_status,
         last_sync_error,
         last_sync_counts,
         raw
       )
       VALUES (
         'stripe',
         $1,
         $2,
         $3,
         $4,
         'connected',
         $7,
         $8,
         CASE WHEN $7::TEXT IS NULL THEN NULL ELSE NOW() END,
         NOW(),
         'succeeded',
         NULL,
         $5,
         $6
       )
       ON CONFLICT (provider, environment) DO UPDATE SET
         provider_account_id = EXCLUDED.provider_account_id,
         account_email = EXCLUDED.account_email,
         account_livemode = EXCLUDED.account_livemode,
         status = 'connected',
         webhook_endpoint_id = CASE
           WHEN $9 THEN EXCLUDED.webhook_endpoint_id
           ELSE payments.provider_connections.webhook_endpoint_id
         END,
         webhook_endpoint_url = CASE
           WHEN $9 THEN EXCLUDED.webhook_endpoint_url
           ELSE payments.provider_connections.webhook_endpoint_url
         END,
         webhook_configured_at = CASE
           WHEN $9 THEN EXCLUDED.webhook_configured_at
           ELSE payments.provider_connections.webhook_configured_at
         END,
         last_synced_at = NOW(),
         last_sync_status = 'succeeded',
         last_sync_error = NULL,
         last_sync_counts = EXCLUDED.last_sync_counts,
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        environment,
        snapshot.account.id,
        snapshot.account.email ?? null,
        environment === 'live',
        {
          products: snapshot.products.length,
          prices: snapshot.prices.length,
        },
        snapshot.account,
        webhookEndpointId,
        webhookEndpointUrl,
        resetManagedWebhook,
      ]
    );
  }

  private normalizeConnectionRow(
    row: StripeConnectionRow,
    maskedKey: string | null
  ): StripeConnection {
    return {
      environment: row.environment,
      status: row.status,
      accountId: row.accountId ?? null,
      accountEmail: row.accountEmail ?? null,
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

  private createEmptyConnection(environment: StripeEnvironment): StripeConnectionRow {
    return {
      environment,
      status: 'unconfigured',
      accountId: null,
      accountEmail: null,
      accountLivemode: null,
      webhookEndpointId: null,
      webhookEndpointUrl: null,
      webhookConfiguredAt: null,
      lastSyncedAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
      lastSyncCounts: {},
    };
  }
}
