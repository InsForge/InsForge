import type { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import {
  maskStripeKey,
  StripeProvider,
  validateStripeSecretKey,
} from '@/providers/payments/stripe.provider.js';
import logger from '@/utils/logger.js';
import { STRIPE_ENVIRONMENTS } from '@/types/payments.js';
import type {
  StripeConnectionRow,
  StripeEnvironment,
  StripePrice,
  StripePriceRow,
  StripeProduct,
  StripeProductRow,
  StripeSyncSnapshot,
} from '@/types/payments.js';
import type {
  GetPaymentsStatusResponse,
  ListPaymentCatalogResponse,
  StripeConnection,
  StripePriceMirror,
  StripeProductMirror,
  GetPaymentsConfigResponse,
} from '@insforge/shared-schemas';

const SECRET_KEY_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'STRIPE_TEST_SECRET_KEY',
  live: 'STRIPE_LIVE_SECRET_KEY',
};

export class PaymentService {
  private static instance: PaymentService;
  private pool: Pool | null = null;

  static getInstance(): PaymentService {
    if (!PaymentService.instance) {
      PaymentService.instance = new PaymentService();
    }

    return PaymentService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async getConfig(): Promise<GetPaymentsConfigResponse> {
    const keys = await Promise.all(
      STRIPE_ENVIRONMENTS.map((environment) => this.getStripeKeyConfig(environment))
    );

    return { keys };
  }

  async setStripeSecretKey(environment: StripeEnvironment, secretKey: string): Promise<void> {
    const trimmedSecretKey = secretKey.trim();
    validateStripeSecretKey(environment, trimmedSecretKey);

    const encryptedValue = EncryptionManager.encrypt(trimmedSecretKey);

    await this.getPool().query(
      `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
       VALUES ($1, $2, true, true)
       ON CONFLICT (key) DO UPDATE SET
         value_ciphertext = EXCLUDED.value_ciphertext,
         is_active = true,
         is_reserved = true,
         updated_at = NOW()`,
      [SECRET_KEY_BY_ENVIRONMENT[environment], encryptedValue]
    );
  }

  async removeStripeSecretKey(environment: StripeEnvironment): Promise<boolean> {
    const result = await this.getPool().query(
      `UPDATE system.secrets
       SET is_active = false,
           updated_at = NOW()
       WHERE key = $1
         AND is_active = true`,
      [SECRET_KEY_BY_ENVIRONMENT[environment]]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async seedStripeKeysFromEnv(): Promise<void> {
    for (const environment of STRIPE_ENVIRONMENTS) {
      const secretKeyName = SECRET_KEY_BY_ENVIRONMENT[environment];
      const secretKey = process.env[secretKeyName]?.trim();

      if (!secretKey) {
        continue;
      }

      try {
        const existingSecretKey = await SecretService.getInstance().getSecretByKey(secretKeyName);
        if (existingSecretKey) {
          continue;
        }

        await this.setStripeSecretKey(environment, secretKey);
        logger.info(`✅ ${secretKeyName} secret initialized`);
      } catch (error) {
        logger.warn(`Failed to initialize ${secretKeyName}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async getStripeSecretKey(environment: StripeEnvironment): Promise<string | null> {
    const secretKey = await SecretService.getInstance().getSecretByKey(
      SECRET_KEY_BY_ENVIRONMENT[environment]
    );

    if (!secretKey) {
      return null;
    }

    validateStripeSecretKey(environment, secretKey);
    return secretKey;
  }

  private async getStripeKeyConfig(environment: StripeEnvironment) {
    const secretKey = await this.getStripeSecretKey(environment);

    return {
      environment,
      hasKey: !!secretKey,
      maskedKey: secretKey ? maskStripeKey(secretKey) : null,
    };
  }

  async getStatus(): Promise<GetPaymentsStatusResponse> {
    const result = await this.getPool().query(
      `SELECT
         environment,
         status,
         stripe_account_id AS "stripeAccountId",
         stripe_account_email AS "stripeAccountEmail",
         account_livemode AS "accountLivemode",
         last_synced_at AS "lastSyncedAt",
         last_sync_status AS "lastSyncStatus",
         last_sync_error AS "lastSyncError",
         last_sync_counts AS "lastSyncCounts"
       FROM payments.stripe_connections
       ORDER BY environment`
    );

    const rowsByEnvironment = new Map<StripeEnvironment, StripeConnectionRow>(
      (result.rows as StripeConnectionRow[]).map((row) => [row.environment, row])
    );

    const connections = await Promise.all(
      STRIPE_ENVIRONMENTS.map(async (environment) => {
        const keyConfig = await this.getStripeKeyConfig(environment);
        return this.normalizeConnectionRow(
          rowsByEnvironment.get(environment) ?? this.createEmptyConnection(environment),
          keyConfig.maskedKey
        );
      })
    );

    return { connections };
  }

  async listCatalog(environment?: StripeEnvironment): Promise<ListPaymentCatalogResponse> {
    const environmentFilter = environment ? 'WHERE environment = $1' : '';
    const params = environment ? [environment] : [];

    const [productsResult, pricesResult] = await Promise.all([
      this.getPool().query(
        `SELECT
           environment,
           stripe_product_id AS "stripeProductId",
           name,
           description,
           active,
           default_price_id AS "defaultPriceId",
           metadata,
           synced_at AS "syncedAt",
           is_deleted AS "isDeleted"
         FROM payments.products
         ${environmentFilter}
         ORDER BY environment, name, stripe_product_id`,
        params
      ),
      this.getPool().query(
        `SELECT
           environment,
           stripe_price_id AS "stripePriceId",
           stripe_product_id AS "stripeProductId",
           active,
           currency,
           unit_amount AS "unitAmount",
           unit_amount_decimal AS "unitAmountDecimal",
           type,
           lookup_key AS "lookupKey",
           billing_scheme AS "billingScheme",
           tax_behavior AS "taxBehavior",
           recurring_interval AS "recurringInterval",
           recurring_interval_count AS "recurringIntervalCount",
           metadata,
           synced_at AS "syncedAt",
           is_deleted AS "isDeleted"
         FROM payments.prices
         ${environmentFilter}
         ORDER BY environment, stripe_product_id, stripe_price_id`,
        params
      ),
    ]);

    return {
      products: (productsResult.rows as StripeProductRow[]).map((row) =>
        this.normalizeProductRow(row)
      ),
      prices: (pricesResult.rows as StripePriceRow[]).map((row) => this.normalizePriceRow(row)),
    };
  }

  async syncAll(): Promise<StripeConnection[]> {
    return Promise.all(STRIPE_ENVIRONMENTS.map((environment) => this.syncEnvironment(environment)));
  }

  async syncEnvironment(environment: StripeEnvironment): Promise<StripeConnection> {
    let secretKey: string | null;

    try {
      secretKey = await this.getStripeSecretKey(environment);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.recordConnectionStatus(environment, 'error', message);
    }

    if (!secretKey) {
      return this.recordConnectionStatus(
        environment,
        'unconfigured',
        `STRIPE_${environment.toUpperCase()}_SECRET_KEY is not configured`
      );
    }

    try {
      const provider = new StripeProvider(secretKey, environment);
      const snapshot = await provider.syncCatalog();

      await this.writeSnapshot(environment, snapshot, new Date());

      return this.getConnection(environment);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Stripe sync failed', { environment, error: message });
      return this.recordConnectionStatus(environment, 'error', message);
    }
  }

  private async getConnection(environment: StripeEnvironment): Promise<StripeConnection> {
    const result = await this.getPool().query(
      `SELECT
         environment,
         status,
         stripe_account_id AS "stripeAccountId",
         stripe_account_email AS "stripeAccountEmail",
         account_livemode AS "accountLivemode",
         last_synced_at AS "lastSyncedAt",
         last_sync_status AS "lastSyncStatus",
         last_sync_error AS "lastSyncError",
         last_sync_counts AS "lastSyncCounts"
       FROM payments.stripe_connections
       WHERE environment = $1`,
      [environment]
    );

    const keyConfig = await this.getStripeKeyConfig(environment);
    return this.normalizeConnectionRow(
      (result.rows[0] as StripeConnectionRow | undefined) ??
        this.createEmptyConnection(environment),
      keyConfig.maskedKey
    );
  }

  private async recordConnectionStatus(
    environment: StripeEnvironment,
    status: 'unconfigured' | 'error',
    error: string
  ): Promise<StripeConnection> {
    const result = await this.getPool().query(
      `INSERT INTO payments.stripe_connections (
         environment,
         status,
         last_sync_status,
         last_sync_error,
         last_sync_counts
       )
       VALUES ($1, $2, 'failed', $3, '{}'::JSONB)
       ON CONFLICT (environment) DO UPDATE SET
         status = EXCLUDED.status,
         last_sync_status = 'failed',
         last_sync_error = EXCLUDED.last_sync_error,
         updated_at = NOW()
       RETURNING
         environment,
         status,
         stripe_account_id AS "stripeAccountId",
         stripe_account_email AS "stripeAccountEmail",
         account_livemode AS "accountLivemode",
         last_synced_at AS "lastSyncedAt",
         last_sync_status AS "lastSyncStatus",
         last_sync_error AS "lastSyncError",
         last_sync_counts AS "lastSyncCounts"`,
      [environment, status, error]
    );

    const keyConfig = await this.getStripeKeyConfig(environment);
    return this.normalizeConnectionRow(result.rows[0] as StripeConnectionRow, keyConfig.maskedKey);
  }

  private async writeSnapshot(
    environment: StripeEnvironment,
    snapshot: StripeSyncSnapshot,
    syncStartedAt: Date
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `payments_sync_${environment}`,
      ]);

      await this.upsertConnection(client, environment, snapshot);
      await this.upsertProducts(client, environment, snapshot.products, syncStartedAt);
      await this.upsertPrices(client, environment, snapshot.prices, syncStartedAt);
      await this.markMissingRowsDeleted(client, environment, syncStartedAt);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertConnection(
    client: PoolClient,
    environment: StripeEnvironment,
    snapshot: StripeSyncSnapshot
  ): Promise<void> {
    await client.query(
      `INSERT INTO payments.stripe_connections (
         environment,
         stripe_account_id,
         stripe_account_email,
         account_livemode,
         status,
         last_synced_at,
         last_sync_status,
         last_sync_error,
         last_sync_counts,
         raw
       )
       VALUES ($1, $2, $3, $4, 'connected', NOW(), 'succeeded', NULL, $5, $6)
       ON CONFLICT (environment) DO UPDATE SET
         stripe_account_id = EXCLUDED.stripe_account_id,
         stripe_account_email = EXCLUDED.stripe_account_email,
         account_livemode = EXCLUDED.account_livemode,
         status = 'connected',
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
      ]
    );
  }

  private async upsertProducts(
    client: PoolClient,
    environment: StripeEnvironment,
    products: StripeProduct[],
    syncStartedAt: Date
  ): Promise<void> {
    for (const product of products) {
      await client.query(
        `INSERT INTO payments.products (
           environment,
           stripe_product_id,
           name,
           description,
           active,
           default_price_id,
           metadata,
           raw,
           synced_at,
           is_deleted
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
         ON CONFLICT (environment, stripe_product_id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           active = EXCLUDED.active,
           default_price_id = EXCLUDED.default_price_id,
           metadata = EXCLUDED.metadata,
           raw = EXCLUDED.raw,
           synced_at = EXCLUDED.synced_at,
           is_deleted = FALSE,
           updated_at = NOW()`,
        [
          environment,
          product.id,
          product.name,
          product.description ?? null,
          product.active,
          this.getStripeObjectId(product.default_price),
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
        `INSERT INTO payments.prices (
           environment,
           stripe_price_id,
           stripe_product_id,
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
           synced_at,
           is_deleted
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, FALSE)
         ON CONFLICT (environment, stripe_price_id) DO UPDATE SET
           stripe_product_id = EXCLUDED.stripe_product_id,
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
           is_deleted = FALSE,
           updated_at = NOW()`,
        [
          environment,
          price.id,
          this.getStripeObjectId(price.product),
          price.active,
          price.currency,
          price.unit_amount ?? null,
          price.unit_amount_decimal ?? null,
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

  private async markMissingRowsDeleted(
    client: PoolClient,
    environment: StripeEnvironment,
    syncStartedAt: Date
  ): Promise<void> {
    await client.query(
      `UPDATE payments.products
       SET is_deleted = TRUE,
           updated_at = NOW()
       WHERE environment = $1
         AND is_deleted = FALSE
         AND synced_at < $2`,
      [environment, syncStartedAt]
    );

    await client.query(
      `UPDATE payments.prices
       SET is_deleted = TRUE,
           updated_at = NOW()
       WHERE environment = $1
         AND is_deleted = FALSE
         AND synced_at < $2`,
      [environment, syncStartedAt]
    );
  }

  private getStripeObjectId(value: unknown): string | null {
    if (!value) {
      return null;
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
      return value.id;
    }

    return null;
  }

  private normalizeConnectionRow(
    row: StripeConnectionRow,
    maskedKey: string | null
  ): StripeConnection {
    return {
      environment: row.environment,
      status: row.status,
      stripeAccountId: row.stripeAccountId ?? null,
      stripeAccountEmail: row.stripeAccountEmail ?? null,
      accountLivemode: row.accountLivemode ?? null,
      maskedKey,
      lastSyncedAt: this.toISOStringOrNull(row.lastSyncedAt),
      lastSyncStatus: row.lastSyncStatus ?? null,
      lastSyncError: row.lastSyncError ?? null,
      lastSyncCounts: row.lastSyncCounts ?? {},
    };
  }

  private normalizeProductRow(row: StripeProductRow): StripeProductMirror {
    return {
      ...row,
      syncedAt: this.toISOString(row.syncedAt),
    };
  }

  private normalizePriceRow(row: StripePriceRow): StripePriceMirror {
    return {
      ...row,
      unitAmount: row.unitAmount === null ? null : Number(row.unitAmount),
      syncedAt: this.toISOString(row.syncedAt),
    };
  }

  private createEmptyConnection(environment: StripeEnvironment): StripeConnectionRow {
    return {
      environment,
      status: 'unconfigured',
      stripeAccountId: null,
      stripeAccountEmail: null,
      accountLivemode: null,
      lastSyncedAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
      lastSyncCounts: {},
    };
  }

  private toISOStringOrNull(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    return this.toISOString(value);
  }

  private toISOString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
  }
}
