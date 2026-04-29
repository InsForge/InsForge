import type { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { AppError } from '@/api/middlewares/error.js';
import {
  maskStripeKey,
  StripeProvider,
  validateStripeSecretKey,
} from '@/providers/payments/stripe.provider.js';
import logger from '@/utils/logger.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  STRIPE_ENVIRONMENTS,
  type PaymentHistoryRow,
  type StripeCheckoutSession,
  type StripeConnectionRow,
  type StripeCustomer,
  type StripeEnvironment,
  type StripeEvent,
  type StripeCharge,
  type StripeInvoice,
  type StripePaymentIntent,
  type StripeRefund,
  type StripeAccount,
  type StripePrice,
  type StripePriceRow,
  type StripeProduct,
  type StripeProductRow,
  type StripeSubscription,
  type StripeSubscriptionItem,
  type StripeSubscriptionItemRow,
  type StripeSubscriptionRow,
  type StripeSyncSnapshot,
  type StripeWebhookEventRow,
  type StripeWebhookEndpoint,
} from '@/types/payments.js';
import { getApiBaseUrl } from '@/utils/environment.js';
import type {
  ArchivePaymentPriceResponse,
  CreatePaymentPriceRequest,
  GetPaymentsStatusResponse,
  GetPaymentPriceResponse,
  ListPaymentCatalogResponse,
  ListPaymentPricesRequest,
  ListPaymentPricesResponse,
  ListPaymentProductsRequest,
  StripeConnection,
  StripePriceMirror,
  StripeProductMirror,
  GetPaymentsConfigResponse,
  CreatePaymentProductRequest,
  DeletePaymentProductResponse,
  GetPaymentProductResponse,
  ListPaymentProductsResponse,
  MutatePaymentPriceResponse,
  MutatePaymentProductResponse,
  UpdatePaymentPriceRequest,
  UpdatePaymentProductRequest,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  BillingSubject,
  StripeWebhookResponse,
  StripeWebhookEvent,
  ListPaymentHistoryRequest,
  ListPaymentHistoryResponse,
  ListSubscriptionsRequest,
  ListSubscriptionsResponse,
  SyncPaymentsRequest,
  SyncPaymentsResponse,
  SyncPaymentsEnvironmentResult,
  SyncPaymentsSubscriptionsSummary,
} from '@insforge/shared-schemas';

const SECRET_KEY_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'STRIPE_TEST_SECRET_KEY',
  live: 'STRIPE_LIVE_SECRET_KEY',
};

const WEBHOOK_SECRET_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'STRIPE_TEST_WEBHOOK_SECRET',
  live: 'STRIPE_LIVE_WEBHOOK_SECRET',
};

const SUBJECT_METADATA_KEYS = {
  type: 'insforge_subject_type',
  id: 'insforge_subject_id',
} as const;

const CHECKOUT_MODE_METADATA_KEY = 'insforge_checkout_mode';

const MANAGED_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'invoice.paid',
  'invoice.payment_failed',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
] as const;

const MANAGED_WEBHOOK_METADATA = {
  managed_by: 'insforge',
  insforge_webhook: 'stripe_payments',
} as const;

interface ManagedStripeWebhookSetup {
  endpointId: string;
  endpointUrl: string;
  secret: string;
}

interface PaymentHistoryContext {
  subjectType: string | null;
  subjectId: string | null;
  stripeCustomerId: string | null;
  customerEmailSnapshot: string | null;
  stripeInvoiceId: string | null;
  stripeSubscriptionId: string | null;
  stripeProductId: string | null;
  stripePriceId: string | null;
  description: string | null;
}

type PaymentHistoryStatus = 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded';

interface SubscriptionProjectionResult {
  synced: boolean;
  unmapped: boolean;
}

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
    await this.withEnvironmentLock(environment, async () => {
      const trimmedSecretKey = secretKey.trim();
      validateStripeSecretKey(environment, trimmedSecretKey);

      const provider = new StripeProvider(trimmedSecretKey, environment);
      const account = await provider.retrieveAccount();
      const encryptedValue = EncryptionManager.encrypt(trimmedSecretKey);
      const shouldClearMirror = await this.shouldClearPaymentMirrorForNewAccount(
        environment,
        account.id
      );
      const webhookSetup = await this.tryRecreateManagedStripeWebhook(provider, environment);

      await this.persistStripeSecretKey(
        environment,
        encryptedValue,
        account,
        shouldClearMirror,
        webhookSetup
      );

      await this.syncPaymentsEnvironmentUnlocked(environment, provider, false);
    });
  }

  async removeStripeSecretKey(environment: StripeEnvironment): Promise<boolean> {
    return this.withEnvironmentLock(environment, async () =>
      this.removeStripeSecretKeyUnlocked(environment)
    );
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
        [SECRET_KEY_BY_ENVIRONMENT[environment]]
      );

      const removed = (result.rowCount ?? 0) > 0;
      if (removed) {
        await client.query(
          `UPDATE system.secrets
           SET is_active = false,
               updated_at = NOW()
           WHERE key = $1
             AND is_active = true`,
          [WEBHOOK_SECRET_BY_ENVIRONMENT[environment]]
        );
        await client.query(
          `UPDATE payments.stripe_connections
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
          [environment, `STRIPE_${environment.toUpperCase()}_SECRET_KEY is not configured`]
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
      SECRET_KEY_BY_ENVIRONMENT[environment]
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

  private async withEnvironmentLock<T>(
    environment: StripeEnvironment,
    task: () => Promise<T>
  ): Promise<T> {
    const client = await this.getPool().connect();
    const lockName = `payments_environment_${environment}`;

    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockName]);
      return await task();
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
      } finally {
        client.release();
      }
    }
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

  private async getStripeWebhookSecret(environment: StripeEnvironment): Promise<string | null> {
    return SecretService.getInstance().getSecretByKey(WEBHOOK_SECRET_BY_ENVIRONMENT[environment]);
  }

  private async clearPaymentMirror(
    client: PoolClient,
    environment: StripeEnvironment
  ): Promise<void> {
    await client.query('DELETE FROM payments.subscription_items WHERE environment = $1', [
      environment,
    ]);
    await client.query('DELETE FROM payments.subscriptions WHERE environment = $1', [environment]);
    await client.query('DELETE FROM payments.payment_history WHERE environment = $1', [
      environment,
    ]);
    await client.query('DELETE FROM payments.stripe_customer_mappings WHERE environment = $1', [
      environment,
    ]);
    await client.query('DELETE FROM payments.webhook_events WHERE environment = $1', [environment]);
    await client.query('DELETE FROM payments.prices WHERE environment = $1', [environment]);
    await client.query('DELETE FROM payments.products WHERE environment = $1', [environment]);
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
      enabledEvents: [...MANAGED_WEBHOOK_EVENTS],
      metadata: {
        ...MANAGED_WEBHOOK_METADATA,
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

  private async tryRecreateManagedStripeWebhook(
    provider: StripeProvider,
    environment: StripeEnvironment
  ): Promise<ManagedStripeWebhookSetup | null> {
    try {
      return await this.recreateManagedStripeWebhook(provider, environment);
    } catch (error) {
      logger.warn('Stripe managed webhook setup skipped during key configuration', {
        environment,
        endpointUrl: this.getManagedStripeWebhookUrl(environment),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
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
    const endpointUrl = this.getManagedStripeWebhookUrl(environment);

    return (
      endpoint.metadata?.managed_by === MANAGED_WEBHOOK_METADATA.managed_by &&
      endpoint.metadata?.insforge_webhook === MANAGED_WEBHOOK_METADATA.insforge_webhook &&
      endpoint.metadata?.insforge_environment === environment &&
      endpoint.url === endpointUrl
    );
  }

  private async createStripeProvider(environment: StripeEnvironment): Promise<StripeProvider> {
    const secretKey = await this.getStripeSecretKey(environment);

    if (!secretKey) {
      throw new AppError(
        `STRIPE_${environment.toUpperCase()}_SECRET_KEY is not configured`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    return new StripeProvider(secretKey, environment);
  }

  private async getStripeKeyConfig(environment: StripeEnvironment) {
    const secretKey = await this.getStripeSecretKey(environment);

    return {
      environment,
      hasKey: !!secretKey,
      maskedKey: secretKey ? maskStripeKey(secretKey) : null,
    };
  }

  private async shouldClearPaymentMirrorForNewAccount(
    environment: StripeEnvironment,
    stripeAccountId: string
  ): Promise<boolean> {
    const result = await this.getPool().query(
      `SELECT
         connection.stripe_account_id AS "stripeAccountId",
         (
           EXISTS (SELECT 1 FROM payments.products WHERE environment = $1)
           OR EXISTS (SELECT 1 FROM payments.prices WHERE environment = $1)
           OR EXISTS (SELECT 1 FROM payments.stripe_customer_mappings WHERE environment = $1)
           OR EXISTS (SELECT 1 FROM payments.payment_history WHERE environment = $1)
           OR EXISTS (SELECT 1 FROM payments.subscriptions WHERE environment = $1)
           OR EXISTS (SELECT 1 FROM payments.subscription_items WHERE environment = $1)
           OR EXISTS (SELECT 1 FROM payments.webhook_events WHERE environment = $1)
         ) AS "hasPaymentRows"
       FROM (SELECT $1::TEXT AS environment) selected_environment
       LEFT JOIN payments.stripe_connections connection
         ON connection.environment = selected_environment.environment`,
      [environment]
    );

    const row = result.rows[0] as
      | { stripeAccountId: string | null; hasPaymentRows: boolean }
      | undefined;
    if (!row) {
      return false;
    }

    if (row.stripeAccountId) {
      return row.stripeAccountId !== stripeAccountId;
    }

    return row.hasPaymentRows;
  }

  private async persistStripeSecretKey(
    environment: StripeEnvironment,
    encryptedValue: string,
    account: StripeAccount,
    clearMirror: boolean,
    webhookSetup: ManagedStripeWebhookSetup | null
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      if (clearMirror) {
        await this.clearPaymentMirror(client, environment);
        logger.info('Cleared Stripe payment mirror after account key change', { environment });
      }

      await client.query(
        `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
         VALUES ($1, $2, true, true)
         ON CONFLICT (key) DO UPDATE SET
           value_ciphertext = EXCLUDED.value_ciphertext,
           is_active = true,
           is_reserved = true,
           updated_at = NOW()`,
        [SECRET_KEY_BY_ENVIRONMENT[environment], encryptedValue]
      );

      if (webhookSetup) {
        await client.query(
          `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
           VALUES ($1, $2, true, true)
           ON CONFLICT (key) DO UPDATE SET
             value_ciphertext = EXCLUDED.value_ciphertext,
             is_active = true,
             is_reserved = true,
             updated_at = NOW()`,
          [
            WEBHOOK_SECRET_BY_ENVIRONMENT[environment],
            EncryptionManager.encrypt(webhookSetup.secret),
          ]
        );
      } else {
        await client.query(
          `UPDATE system.secrets
           SET is_active = false,
               updated_at = NOW()
           WHERE key = $1
             AND is_active = true`,
          [WEBHOOK_SECRET_BY_ENVIRONMENT[environment]]
        );
      }

      await client.query(
        `INSERT INTO payments.stripe_connections (
           environment,
           stripe_account_id,
           stripe_account_email,
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
         ON CONFLICT (environment) DO UPDATE SET
           stripe_account_id = EXCLUDED.stripe_account_id,
           stripe_account_email = EXCLUDED.stripe_account_email,
           account_livemode = EXCLUDED.account_livemode,
           status = 'connected',
           webhook_endpoint_id = EXCLUDED.webhook_endpoint_id,
           webhook_endpoint_url = EXCLUDED.webhook_endpoint_url,
           webhook_configured_at = EXCLUDED.webhook_configured_at,
           last_synced_at = CASE
             WHEN $8 THEN NULL
             ELSE payments.stripe_connections.last_synced_at
           END,
           last_sync_status = CASE
             WHEN $8 THEN NULL
             ELSE payments.stripe_connections.last_sync_status
           END,
           last_sync_error = NULL,
           last_sync_counts = CASE
             WHEN $8 THEN '{}'::JSONB
             ELSE payments.stripe_connections.last_sync_counts
           END,
           raw = EXCLUDED.raw,
           updated_at = NOW()`,
        [
          environment,
          account.id,
          account.email ?? null,
          environment === 'live',
          webhookSetup?.endpointId ?? null,
          webhookSetup?.endpointUrl ?? null,
          account,
          clearMirror,
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

  async getStatus(): Promise<GetPaymentsStatusResponse> {
    const result = await this.getPool().query(
      `SELECT
         environment,
         status,
         stripe_account_id AS "stripeAccountId",
         stripe_account_email AS "stripeAccountEmail",
         account_livemode AS "accountLivemode",
         webhook_endpoint_id AS "webhookEndpointId",
         webhook_endpoint_url AS "webhookEndpointUrl",
         webhook_configured_at AS "webhookConfiguredAt",
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
           synced_at AS "syncedAt"
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
           synced_at AS "syncedAt"
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

  async listProducts(input: ListPaymentProductsRequest): Promise<ListPaymentProductsResponse> {
    const catalog = await this.listCatalog(input.environment);
    return { products: catalog.products };
  }

  async getProduct(
    environment: StripeEnvironment,
    stripeProductId: string
  ): Promise<GetPaymentProductResponse> {
    const catalog = await this.listCatalog(environment);
    const product = catalog.products.find((item) => item.stripeProductId === stripeProductId);

    if (!product) {
      throw new AppError(
        `Stripe ${environment} product not found: ${stripeProductId}`,
        404,
        ERROR_CODES.NOT_FOUND
      );
    }

    return {
      product,
      prices: catalog.prices.filter((price) => price.stripeProductId === stripeProductId),
    };
  }

  async listPrices(filters: ListPaymentPricesRequest): Promise<ListPaymentPricesResponse> {
    const catalog = await this.listCatalog(filters.environment);
    const prices = filters.stripeProductId
      ? catalog.prices.filter((price) => price.stripeProductId === filters.stripeProductId)
      : catalog.prices;

    return { prices };
  }

  async getPrice(
    environment: StripeEnvironment,
    stripePriceId: string
  ): Promise<GetPaymentPriceResponse> {
    const catalog = await this.listCatalog(environment);
    const price = catalog.prices.find((item) => item.stripePriceId === stripePriceId);

    if (!price) {
      throw new AppError(
        `Stripe ${environment} price not found: ${stripePriceId}`,
        404,
        ERROR_CODES.NOT_FOUND
      );
    }

    return { price };
  }

  async listPaymentHistory(input: ListPaymentHistoryRequest): Promise<ListPaymentHistoryResponse> {
    const params: Array<string | number> = [input.environment];
    const filters = ['environment = $1'];

    if (input.subjectType && input.subjectId) {
      params.push(input.subjectType, input.subjectId);
      filters.push(`subject_type = $${params.length - 1}`, `subject_id = $${params.length}`);
    }

    params.push(input.limit);

    const result = await this.getPool().query(
      `SELECT
         environment,
         type,
         status,
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         stripe_customer_id AS "stripeCustomerId",
         customer_email_snapshot AS "customerEmailSnapshot",
         stripe_checkout_session_id AS "stripeCheckoutSessionId",
         stripe_payment_intent_id AS "stripePaymentIntentId",
         stripe_invoice_id AS "stripeInvoiceId",
         stripe_charge_id AS "stripeChargeId",
         stripe_refund_id AS "stripeRefundId",
         stripe_subscription_id AS "stripeSubscriptionId",
         stripe_product_id AS "stripeProductId",
         stripe_price_id AS "stripePriceId",
         amount,
         amount_refunded AS "amountRefunded",
         currency,
         description,
         paid_at AS "paidAt",
         failed_at AS "failedAt",
         refunded_at AS "refundedAt",
         stripe_created_at AS "stripeCreatedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM payments.payment_history
       WHERE ${filters.join(' AND ')}
       ORDER BY COALESCE(stripe_created_at, created_at) DESC
       LIMIT $${params.length}`,
      params
    );

    return {
      paymentHistory: (result.rows as PaymentHistoryRow[]).map((row) =>
        this.normalizePaymentHistoryRow(row)
      ),
    };
  }

  async listSubscriptions(input: ListSubscriptionsRequest): Promise<ListSubscriptionsResponse> {
    const params: Array<string | number> = [input.environment];
    const filters = ['environment = $1'];

    if (input.subjectType && input.subjectId) {
      params.push(input.subjectType, input.subjectId);
      filters.push(`subject_type = $${params.length - 1}`, `subject_id = $${params.length}`);
    }

    params.push(input.limit);

    const subscriptionsResult = await this.getPool().query(
      `SELECT
         environment,
         stripe_subscription_id AS "stripeSubscriptionId",
         stripe_customer_id AS "stripeCustomerId",
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         status,
         current_period_start AS "currentPeriodStart",
         current_period_end AS "currentPeriodEnd",
         cancel_at_period_end AS "cancelAtPeriodEnd",
         cancel_at AS "cancelAt",
         canceled_at AS "canceledAt",
         trial_start AS "trialStart",
         trial_end AS "trialEnd",
         latest_invoice_id AS "latestInvoiceId",
         metadata,
         synced_at AS "syncedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM payments.subscriptions
       WHERE ${filters.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT $${params.length}`,
      params
    );

    const subscriptionRows = subscriptionsResult.rows as StripeSubscriptionRow[];
    if (subscriptionRows.length === 0) {
      return { subscriptions: [] };
    }

    const subscriptionIds = subscriptionRows.map((row) => row.stripeSubscriptionId);
    const itemsResult = await this.getPool().query(
      `SELECT
         environment,
         stripe_subscription_item_id AS "stripeSubscriptionItemId",
         stripe_subscription_id AS "stripeSubscriptionId",
         stripe_product_id AS "stripeProductId",
         stripe_price_id AS "stripePriceId",
         quantity,
         metadata,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM payments.subscription_items
       WHERE environment = $1
         AND stripe_subscription_id = ANY($2::TEXT[])
       ORDER BY stripe_subscription_id, stripe_subscription_item_id`,
      [input.environment, subscriptionIds]
    );

    const itemsBySubscriptionId = new Map<string, StripeSubscriptionItemRow[]>();
    for (const item of itemsResult.rows as StripeSubscriptionItemRow[]) {
      const items = itemsBySubscriptionId.get(item.stripeSubscriptionId) ?? [];
      items.push(item);
      itemsBySubscriptionId.set(item.stripeSubscriptionId, items);
    }

    return {
      subscriptions: subscriptionRows.map((row) => ({
        ...this.normalizeSubscriptionRow(row),
        items: (itemsBySubscriptionId.get(row.stripeSubscriptionId) ?? []).map((item) =>
          this.normalizeSubscriptionItemRow(item)
        ),
      })),
    };
  }

  private async syncSubscriptionsWithProviderUnlocked(
    environment: StripeEnvironment,
    provider: StripeProvider
  ): Promise<SyncPaymentsSubscriptionsSummary> {
    const subscriptions = await provider.listSubscriptions();
    let synced = 0;
    let unmapped = 0;

    for (const subscription of subscriptions) {
      const result = await this.upsertSubscriptionProjection(environment, subscription);
      if (result.synced) {
        synced += 1;
      }
      if (result.unmapped) {
        unmapped += 1;
      }
    }

    const deleted = await this.deleteMissingSyncedSubscriptions(
      environment,
      subscriptions.map((subscription) => subscription.id)
    );

    return {
      environment,
      synced,
      unmapped,
      deleted,
    };
  }

  async createProduct(input: CreatePaymentProductRequest): Promise<MutatePaymentProductResponse> {
    const { environment, ...productInput } = input;

    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.createStripeProvider(environment);
      const product = await provider.createProduct(productInput);

      await this.upsertProductMirror(environment, product);

      return {
        product: this.normalizeStripeProduct(product, environment),
      };
    });
  }

  async updateProduct(
    stripeProductId: string,
    input: UpdatePaymentProductRequest
  ): Promise<MutatePaymentProductResponse> {
    const { environment, ...productInput } = input;

    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.createStripeProvider(environment);
      const product = await provider.updateProduct(stripeProductId, productInput);

      await this.upsertProductMirror(environment, product);

      return {
        product: this.normalizeStripeProduct(product, environment),
      };
    });
  }

  async deleteProduct(
    environment: StripeEnvironment,
    stripeProductId: string
  ): Promise<DeletePaymentProductResponse> {
    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.createStripeProvider(environment);
      const deletedProduct = await provider.deleteProduct(stripeProductId);

      if (deletedProduct.deleted) {
        await this.deleteProductMirror(environment, deletedProduct.id);
      }

      return {
        stripeProductId: deletedProduct.id,
        deleted: deletedProduct.deleted,
      };
    });
  }

  async createPrice(input: CreatePaymentPriceRequest): Promise<MutatePaymentPriceResponse> {
    const { environment, ...priceInput } = input;

    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.createStripeProvider(environment);
      const price = await provider.createPrice(priceInput);

      await this.upsertPriceMirror(environment, price);

      return {
        price: this.normalizeStripePrice(price, environment),
      };
    });
  }

  async updatePrice(
    stripePriceId: string,
    input: UpdatePaymentPriceRequest
  ): Promise<MutatePaymentPriceResponse> {
    const { environment, ...priceInput } = input;

    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.createStripeProvider(environment);
      const price = await provider.updatePrice(stripePriceId, priceInput);

      await this.upsertPriceMirror(environment, price);

      return {
        price: this.normalizeStripePrice(price, environment),
      };
    });
  }

  async archivePrice(
    environment: StripeEnvironment,
    stripePriceId: string
  ): Promise<ArchivePaymentPriceResponse> {
    return this.withEnvironmentLock(environment, async () => {
      const provider = await this.createStripeProvider(environment);
      const price = await provider.updatePrice(stripePriceId, { active: false });

      await this.upsertPriceMirror(environment, price);

      return {
        price: this.normalizeStripePrice(price, environment),
        archived: !price.active,
      };
    });
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionRequest
  ): Promise<CreateCheckoutSessionResponse> {
    if (input.mode === 'subscription' && !input.subject) {
      throw new AppError(
        'Subscription checkout requires a billing subject',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    return this.withEnvironmentLock(input.environment, async () => {
      const provider = await this.createStripeProvider(input.environment);
      const metadata = this.buildStripeMetadata(input.metadata, input.subject, input.mode);
      const customerId = await this.resolveCheckoutCustomer(input, provider, metadata);
      const checkoutSession = await provider.createCheckoutSession({
        mode: input.mode,
        lineItems: input.lineItems,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        customerId,
        customerEmail: customerId ? null : input.customerEmail,
        metadata,
      });

      return {
        checkoutSession: this.normalizeCheckoutSession(checkoutSession, input.environment),
      };
    });
  }

  async handleStripeWebhook(
    environment: StripeEnvironment,
    rawBody: Buffer,
    signature: string
  ): Promise<StripeWebhookResponse> {
    const webhookSecret = await this.getStripeWebhookSecret(environment);
    if (!webhookSecret) {
      throw new AppError(
        `${WEBHOOK_SECRET_BY_ENVIRONMENT[environment]} is not configured`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const provider = await this.createStripeProvider(environment);
    const event = provider.constructWebhookEvent(rawBody, signature, webhookSecret);
    const eventStart = await this.recordWebhookEventStart(environment, event);

    if (!eventStart.shouldProcess) {
      return {
        received: true,
        handled: false,
        event: this.normalizeWebhookEventRow(eventStart.row),
      };
    }

    try {
      const handled = await this.applyStripeWebhookEvent(environment, event);
      const row = await this.markWebhookEvent(
        environment,
        event.id,
        handled ? 'processed' : 'ignored',
        null
      );

      return {
        received: true,
        handled,
        event: this.normalizeWebhookEventRow(row),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markWebhookEvent(environment, event.id, 'failed', message);
      throw error;
    }
  }

  async syncPayments(input: SyncPaymentsRequest): Promise<SyncPaymentsResponse> {
    const environments = input.environment === 'all' ? STRIPE_ENVIRONMENTS : [input.environment];
    const results = await Promise.all(
      environments.map((environment) =>
        this.withEnvironmentLock(environment, async () =>
          this.syncPaymentsEnvironmentUnlocked(environment)
        )
      )
    );

    return { results };
  }

  private async syncPaymentsEnvironmentUnlocked(
    environment: StripeEnvironment,
    providerOverride?: StripeProvider,
    checkAccountChange = true
  ): Promise<SyncPaymentsEnvironmentResult> {
    let provider = providerOverride;

    if (!provider) {
      let secretKey: string | null;

      try {
        secretKey = await this.getStripeSecretKey(environment);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const connection = await this.recordConnectionStatus(environment, 'error', message);
        return { environment, connection, subscriptions: null };
      }

      if (!secretKey) {
        const connection = await this.recordConnectionStatus(
          environment,
          'unconfigured',
          `STRIPE_${environment.toUpperCase()}_SECRET_KEY is not configured`
        );
        return { environment, connection, subscriptions: null };
      }

      provider = new StripeProvider(secretKey, environment);
    }

    try {
      let connection = await this.syncCatalogWithProviderUnlocked(
        environment,
        provider,
        checkAccountChange
      );

      if (connection.status !== 'connected') {
        return { environment, connection, subscriptions: null };
      }

      const subscriptions = await this.syncSubscriptionsWithProviderUnlocked(environment, provider);
      connection = await this.getConnection(environment);

      return { environment, connection, subscriptions };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Stripe payments sync failed', { environment, error: message });
      const connection = await this.recordConnectionStatus(environment, 'error', message);
      return { environment, connection, subscriptions: null };
    }
  }

  private async syncCatalogWithProviderUnlocked(
    environment: StripeEnvironment,
    provider: StripeProvider,
    checkAccountChange: boolean
  ): Promise<StripeConnection> {
    const snapshot = await provider.syncCatalog();
    const shouldClearMirror = checkAccountChange
      ? await this.shouldClearPaymentMirrorForNewAccount(environment, snapshot.account.id)
      : false;

    await this.writeSnapshot(environment, snapshot, new Date(), shouldClearMirror);

    return this.getConnection(environment);
  }

  private async getConnection(environment: StripeEnvironment): Promise<StripeConnection> {
    const result = await this.getPool().query(
      `SELECT
         environment,
         status,
         stripe_account_id AS "stripeAccountId",
         stripe_account_email AS "stripeAccountEmail",
         account_livemode AS "accountLivemode",
         webhook_endpoint_id AS "webhookEndpointId",
         webhook_endpoint_url AS "webhookEndpointUrl",
         webhook_configured_at AS "webhookConfiguredAt",
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
         webhook_endpoint_id = CASE
           WHEN $2 = 'unconfigured' THEN NULL
           ELSE payments.stripe_connections.webhook_endpoint_id
         END,
         webhook_endpoint_url = CASE
           WHEN $2 = 'unconfigured' THEN NULL
           ELSE payments.stripe_connections.webhook_endpoint_url
         END,
         webhook_configured_at = CASE
           WHEN $2 = 'unconfigured' THEN NULL
           ELSE payments.stripe_connections.webhook_configured_at
         END,
         updated_at = NOW()
       RETURNING
         environment,
         status,
         stripe_account_id AS "stripeAccountId",
         stripe_account_email AS "stripeAccountEmail",
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

  private async writeSnapshot(
    environment: StripeEnvironment,
    snapshot: StripeSyncSnapshot,
    syncStartedAt: Date,
    clearMirror = false
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `payments_sync_${environment}`,
      ]);

      if (clearMirror) {
        await this.clearPaymentMirror(client, environment);
        logger.info('Cleared Stripe payment mirror during catalog sync after account change', {
          environment,
        });
      }

      await this.upsertConnection(client, environment, snapshot);
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
           synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (environment, stripe_product_id) DO UPDATE SET
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
           synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
           updated_at = NOW()`,
        [
          environment,
          price.id,
          this.getStripeObjectId(price.product),
          price.active,
          price.currency,
          price.unit_amount ?? null,
          this.normalizeStripeDecimal(price.unit_amount_decimal),
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
    stripeProductIds: string[],
    stripePriceIds: string[]
  ): Promise<void> {
    await client.query(
      `DELETE FROM payments.prices
       WHERE environment = $1
         AND NOT (stripe_price_id = ANY($2::TEXT[]))`,
      [environment, stripePriceIds]
    );

    await client.query(
      `DELETE FROM payments.products
       WHERE environment = $1
         AND NOT (stripe_product_id = ANY($2::TEXT[]))`,
      [environment, stripeProductIds]
    );
  }

  private async upsertProductMirror(
    environment: StripeEnvironment,
    product: StripeProduct
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await this.upsertProducts(client, environment, [product], new Date());
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertPriceMirror(
    environment: StripeEnvironment,
    price: StripePrice
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await this.upsertPrices(client, environment, [price], new Date());
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async deleteProductMirror(
    environment: StripeEnvironment,
    stripeProductId: string
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM payments.prices
         WHERE environment = $1
           AND stripe_product_id = $2`,
        [environment, stripeProductId]
      );
      await client.query(
        `DELETE FROM payments.products
         WHERE environment = $1
           AND stripe_product_id = $2`,
        [environment, stripeProductId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async resolveCheckoutCustomer(
    input: CreateCheckoutSessionRequest,
    provider: StripeProvider,
    metadata: Record<string, string>
  ): Promise<string | null> {
    if (!input.subject) {
      return null;
    }

    const existing = await this.findStripeCustomerMapping(input.environment, input.subject);
    if (existing) {
      return existing.stripeCustomerId;
    }

    const customer = await provider.createCustomer({
      email: input.customerEmail ?? null,
      metadata,
    });

    await this.upsertStripeCustomerMapping(
      input.environment,
      input.subject,
      customer,
      input.customerEmail ?? null,
      metadata
    );

    return customer.id;
  }

  private async findStripeCustomerMapping(
    environment: StripeEnvironment,
    subject: BillingSubject
  ): Promise<{ stripeCustomerId: string } | null> {
    const result = await this.getPool().query(
      `SELECT stripe_customer_id AS "stripeCustomerId"
       FROM payments.stripe_customer_mappings
       WHERE environment = $1
         AND subject_type = $2
         AND subject_id = $3`,
      [environment, subject.type, subject.id]
    );

    return (result.rows[0] as { stripeCustomerId: string } | undefined) ?? null;
  }

  private async upsertStripeCustomerMapping(
    environment: StripeEnvironment,
    subject: BillingSubject,
    customer: StripeCustomer,
    customerEmailSnapshot: string | null,
    metadata: Record<string, string>
  ): Promise<void> {
    await this.getPool().query(
      `INSERT INTO payments.stripe_customer_mappings (
         environment,
         subject_type,
         subject_id,
         stripe_customer_id,
         customer_email_snapshot,
         metadata,
         raw
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (environment, subject_type, subject_id) DO UPDATE SET
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         customer_email_snapshot = EXCLUDED.customer_email_snapshot,
         metadata = EXCLUDED.metadata,
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        environment,
        subject.type,
        subject.id,
        customer.id,
        customerEmailSnapshot,
        metadata,
        customer,
      ]
    );
  }

  private async findStripeCustomerMappingByCustomerId(
    environment: StripeEnvironment,
    stripeCustomerId: string
  ): Promise<{ subjectType: string; subjectId: string } | null> {
    const result = await this.getPool().query(
      `SELECT
         subject_type AS "subjectType",
         subject_id AS "subjectId"
       FROM payments.stripe_customer_mappings
       WHERE environment = $1
         AND stripe_customer_id = $2`,
      [environment, stripeCustomerId]
    );

    return (result.rows[0] as { subjectType: string; subjectId: string } | undefined) ?? null;
  }

  private buildStripeMetadata(
    metadata: Record<string, string> | undefined,
    subject: BillingSubject | undefined,
    checkoutMode?: 'payment' | 'subscription'
  ): Record<string, string> {
    const stripeMetadata = { ...(metadata ?? {}) };
    if (checkoutMode) {
      stripeMetadata[CHECKOUT_MODE_METADATA_KEY] = checkoutMode;
    }

    if (subject) {
      stripeMetadata[SUBJECT_METADATA_KEYS.type] = subject.type;
      stripeMetadata[SUBJECT_METADATA_KEYS.id] = subject.id;
    }

    return stripeMetadata;
  }

  private async recordWebhookEventStart(
    environment: StripeEnvironment,
    event: StripeEvent
  ): Promise<{ row: StripeWebhookEventRow; shouldProcess: boolean }> {
    const object = event.data.object as unknown;
    const objectType = this.getStripeObjectType(object);
    const objectId = this.getStripeObjectId(object);
    const stripeAccountId = typeof event.account === 'string' ? event.account : null;

    const insertResult = await this.getPool().query(
      `INSERT INTO payments.webhook_events (
         environment,
         stripe_event_id,
         event_type,
         livemode,
         stripe_account_id,
         object_type,
         object_id,
         processing_status,
         attempt_count,
         payload
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 1, $8)
       ON CONFLICT (environment, stripe_event_id) DO NOTHING
       RETURNING
         environment,
         stripe_event_id AS "stripeEventId",
         event_type AS "eventType",
         livemode,
         stripe_account_id AS "stripeAccountId",
         object_type AS "objectType",
         object_id AS "objectId",
         processing_status AS "processingStatus",
         attempt_count AS "attemptCount",
         last_error AS "lastError",
         received_at AS "receivedAt",
         processed_at AS "processedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [
        environment,
        event.id,
        event.type,
        event.livemode,
        stripeAccountId,
        objectType,
        objectId,
        event,
      ]
    );

    const inserted = insertResult.rows[0] as StripeWebhookEventRow | undefined;
    if (inserted) {
      return { row: inserted, shouldProcess: true };
    }

    const existingResult = await this.getPool().query(
      `SELECT
         environment,
         stripe_event_id AS "stripeEventId",
         event_type AS "eventType",
         livemode,
         stripe_account_id AS "stripeAccountId",
         object_type AS "objectType",
         object_id AS "objectId",
         processing_status AS "processingStatus",
         attempt_count AS "attemptCount",
         last_error AS "lastError",
         received_at AS "receivedAt",
         processed_at AS "processedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM payments.webhook_events
       WHERE environment = $1
         AND stripe_event_id = $2`,
      [environment, event.id]
    );

    const existing = existingResult.rows[0] as StripeWebhookEventRow;
    if (existing.processingStatus === 'processed' || existing.processingStatus === 'ignored') {
      return { row: existing, shouldProcess: false };
    }

    const retryResult = await this.getPool().query(
      `UPDATE payments.webhook_events
       SET processing_status = 'pending',
           attempt_count = attempt_count + 1,
           last_error = NULL,
           payload = $3,
           updated_at = NOW()
       WHERE environment = $1
         AND stripe_event_id = $2
       RETURNING
         environment,
         stripe_event_id AS "stripeEventId",
         event_type AS "eventType",
         livemode,
         stripe_account_id AS "stripeAccountId",
         object_type AS "objectType",
         object_id AS "objectId",
         processing_status AS "processingStatus",
         attempt_count AS "attemptCount",
         last_error AS "lastError",
         received_at AS "receivedAt",
         processed_at AS "processedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [environment, event.id, event]
    );

    return { row: retryResult.rows[0] as StripeWebhookEventRow, shouldProcess: true };
  }

  private async markWebhookEvent(
    environment: StripeEnvironment,
    stripeEventId: string,
    processingStatus: 'processed' | 'failed' | 'ignored',
    error: string | null
  ): Promise<StripeWebhookEventRow> {
    const result = await this.getPool().query(
      `UPDATE payments.webhook_events
       SET processing_status = $3,
           last_error = $4,
           processed_at = CASE WHEN $3 IN ('processed', 'ignored') THEN NOW() ELSE processed_at END,
           updated_at = NOW()
       WHERE environment = $1
         AND stripe_event_id = $2
       RETURNING
         environment,
         stripe_event_id AS "stripeEventId",
         event_type AS "eventType",
         livemode,
         stripe_account_id AS "stripeAccountId",
         object_type AS "objectType",
         object_id AS "objectId",
         processing_status AS "processingStatus",
         attempt_count AS "attemptCount",
         last_error AS "lastError",
         received_at AS "receivedAt",
         processed_at AS "processedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [environment, stripeEventId, processingStatus, error]
    );

    return result.rows[0] as StripeWebhookEventRow;
  }

  private async applyStripeWebhookEvent(
    environment: StripeEnvironment,
    event: StripeEvent
  ): Promise<boolean> {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.processCheckoutSessionCompleted(
          environment,
          event.data.object as StripeCheckoutSession
        );
      case 'checkout.session.async_payment_succeeded':
        return this.processCheckoutSessionCompleted(
          environment,
          event.data.object as StripeCheckoutSession,
          'succeeded'
        );
      case 'checkout.session.async_payment_failed':
        return this.processCheckoutSessionCompleted(
          environment,
          event.data.object as StripeCheckoutSession,
          'failed'
        );
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await this.upsertInvoicePaymentHistory(
          environment,
          event.data.object as StripeInvoice,
          'succeeded'
        );
        return true;
      case 'invoice.payment_failed':
        await this.upsertInvoicePaymentHistory(
          environment,
          event.data.object as StripeInvoice,
          'failed'
        );
        return true;
      case 'payment_intent.succeeded':
        return this.processPaymentIntentHistory(
          environment,
          event.data.object as StripePaymentIntent,
          'succeeded'
        );
      case 'payment_intent.payment_failed':
        return this.processPaymentIntentHistory(
          environment,
          event.data.object as StripePaymentIntent,
          'failed'
        );
      case 'charge.refunded':
        await this.updatePaymentHistoryFromRefundedCharge(
          environment,
          event.data.object as StripeCharge
        );
        return true;
      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed':
        await this.upsertRefundPaymentHistory(environment, event.data.object as StripeRefund);
        return true;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        return (
          await this.upsertSubscriptionProjection(
            environment,
            event.data.object as StripeSubscription
          )
        ).synced;
      default:
        return false;
    }
  }

  private async processCheckoutSessionCompleted(
    environment: StripeEnvironment,
    checkoutSession: StripeCheckoutSession,
    statusOverride?: PaymentHistoryStatus
  ): Promise<boolean> {
    if (checkoutSession.mode !== 'payment') {
      return false;
    }

    await this.upsertCheckoutPaymentHistory(environment, checkoutSession, statusOverride);
    return true;
  }

  private async upsertCheckoutPaymentHistory(
    environment: StripeEnvironment,
    checkoutSession: StripeCheckoutSession,
    statusOverride?: PaymentHistoryStatus
  ): Promise<void> {
    const subject = this.getBillingSubjectFromMetadata(checkoutSession.metadata);
    const stripePaymentIntentId = this.getStripeObjectId(checkoutSession.payment_intent);
    const status =
      statusOverride ?? (checkoutSession.payment_status === 'paid' ? 'succeeded' : 'pending');

    await this.getPool().query(
      `INSERT INTO payments.payment_history (
         environment,
         type,
         status,
         subject_type,
         subject_id,
         stripe_customer_id,
         customer_email_snapshot,
         stripe_checkout_session_id,
         stripe_payment_intent_id,
         stripe_subscription_id,
         amount,
         currency,
         description,
         paid_at,
         stripe_created_at,
         raw
       )
       VALUES ($1, 'one_time_payment', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (environment, stripe_payment_intent_id)
         WHERE stripe_payment_intent_id IS NOT NULL
       DO UPDATE SET
         status = EXCLUDED.status,
         subject_type = EXCLUDED.subject_type,
         subject_id = EXCLUDED.subject_id,
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         customer_email_snapshot = EXCLUDED.customer_email_snapshot,
         stripe_checkout_session_id = EXCLUDED.stripe_checkout_session_id,
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         description = EXCLUDED.description,
         paid_at = EXCLUDED.paid_at,
         stripe_created_at = EXCLUDED.stripe_created_at,
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        environment,
        status,
        subject?.type ?? null,
        subject?.id ?? null,
        this.getStripeObjectId(checkoutSession.customer),
        checkoutSession.customer_details?.email ?? null,
        checkoutSession.id,
        stripePaymentIntentId,
        this.getStripeObjectId(checkoutSession.subscription),
        checkoutSession.amount_total ?? null,
        checkoutSession.currency ?? null,
        null,
        status === 'succeeded' ? new Date() : null,
        this.fromStripeTimestamp(checkoutSession.created),
        checkoutSession,
      ]
    );
  }

  private async upsertInvoicePaymentHistory(
    environment: StripeEnvironment,
    invoice: StripeInvoice,
    status: 'succeeded' | 'failed'
  ): Promise<void> {
    const stripeCustomerId = this.getStripeObjectId(invoice.customer);
    const subscriptionId = this.getInvoiceSubscriptionId(invoice);
    const subject = await this.resolveInvoiceSubject(environment, invoice, stripeCustomerId);
    const stripePaymentIntentId = this.getInvoicePaymentIntentId(invoice);
    const firstLine = invoice.lines?.data?.[0] ?? null;
    const stripeProductId = this.getInvoiceLineItemProductId(firstLine);
    const stripePriceId = this.getInvoiceLineItemPriceId(firstLine);
    const paidAt =
      status === 'succeeded'
        ? (this.fromStripeTimestamp(invoice.status_transitions?.paid_at) ??
          this.fromStripeTimestamp(invoice.created))
        : null;
    const failedAt = status === 'failed' ? this.fromStripeTimestamp(invoice.created) : null;

    await this.getPool().query(
      `INSERT INTO payments.payment_history (
         environment,
         type,
         status,
         subject_type,
         subject_id,
         stripe_customer_id,
         customer_email_snapshot,
         stripe_payment_intent_id,
         stripe_invoice_id,
         stripe_subscription_id,
         stripe_product_id,
         stripe_price_id,
         amount,
         currency,
         description,
         paid_at,
         failed_at,
         stripe_created_at,
         raw
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (environment, stripe_invoice_id)
         WHERE stripe_invoice_id IS NOT NULL
       DO UPDATE SET
         type = EXCLUDED.type,
         status = EXCLUDED.status,
         subject_type = EXCLUDED.subject_type,
         subject_id = EXCLUDED.subject_id,
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         customer_email_snapshot = EXCLUDED.customer_email_snapshot,
         stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id,
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         stripe_product_id = EXCLUDED.stripe_product_id,
         stripe_price_id = EXCLUDED.stripe_price_id,
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         description = EXCLUDED.description,
         paid_at = EXCLUDED.paid_at,
         failed_at = EXCLUDED.failed_at,
         stripe_created_at = EXCLUDED.stripe_created_at,
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        environment,
        subscriptionId ? 'subscription_invoice' : 'one_time_payment',
        status,
        subject?.type ?? null,
        subject?.id ?? null,
        stripeCustomerId,
        invoice.customer_email ?? null,
        stripePaymentIntentId,
        invoice.id,
        subscriptionId,
        stripeProductId,
        stripePriceId,
        status === 'succeeded' ? invoice.amount_paid : invoice.amount_due,
        invoice.currency,
        invoice.description ?? invoice.number ?? null,
        paidAt,
        failedAt,
        this.fromStripeTimestamp(invoice.created),
        invoice,
      ]
    );
  }

  private async processPaymentIntentHistory(
    environment: StripeEnvironment,
    paymentIntent: StripePaymentIntent,
    status: 'succeeded' | 'failed'
  ): Promise<boolean> {
    if (paymentIntent.metadata?.[CHECKOUT_MODE_METADATA_KEY] !== 'payment') {
      return false;
    }

    await this.upsertPaymentIntentHistory(environment, paymentIntent, status);
    return true;
  }

  private async upsertPaymentIntentHistory(
    environment: StripeEnvironment,
    paymentIntent: StripePaymentIntent,
    status: 'succeeded' | 'failed'
  ): Promise<void> {
    const subject = this.getBillingSubjectFromMetadata(paymentIntent.metadata);

    await this.getPool().query(
      `INSERT INTO payments.payment_history (
         environment,
         type,
         status,
         subject_type,
         subject_id,
         stripe_customer_id,
         customer_email_snapshot,
         stripe_payment_intent_id,
         stripe_charge_id,
         amount,
         currency,
         description,
         paid_at,
         failed_at,
         stripe_created_at,
         raw
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (environment, stripe_payment_intent_id)
         WHERE stripe_payment_intent_id IS NOT NULL
       DO UPDATE SET
         type = EXCLUDED.type,
         status = EXCLUDED.status,
         subject_type = EXCLUDED.subject_type,
         subject_id = EXCLUDED.subject_id,
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         customer_email_snapshot = EXCLUDED.customer_email_snapshot,
         stripe_charge_id = EXCLUDED.stripe_charge_id,
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         description = EXCLUDED.description,
         paid_at = EXCLUDED.paid_at,
         failed_at = EXCLUDED.failed_at,
         stripe_created_at = EXCLUDED.stripe_created_at,
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        environment,
        status === 'succeeded' ? 'one_time_payment' : 'failed_payment',
        status,
        subject?.type ?? null,
        subject?.id ?? null,
        this.getStripeObjectId(paymentIntent.customer),
        paymentIntent.receipt_email ?? null,
        paymentIntent.id,
        this.getStripeObjectId(paymentIntent.latest_charge),
        status === 'succeeded' ? paymentIntent.amount_received : paymentIntent.amount,
        paymentIntent.currency,
        paymentIntent.description ?? null,
        status === 'succeeded' ? this.fromStripeTimestamp(paymentIntent.created) : null,
        status === 'failed' ? this.fromStripeTimestamp(paymentIntent.created) : null,
        this.fromStripeTimestamp(paymentIntent.created),
        paymentIntent,
      ]
    );
  }

  private async upsertRefundPaymentHistory(
    environment: StripeEnvironment,
    refund: StripeRefund
  ): Promise<void> {
    const stripePaymentIntentId = this.getStripeObjectId(refund.payment_intent);
    const stripeChargeId = this.getStripeObjectId(refund.charge);
    const context = await this.findPaymentHistoryContextForRefund(
      environment,
      stripePaymentIntentId,
      stripeChargeId
    );
    const mappedStatus = this.mapRefundStatus(refund.status);

    await this.getPool().query(
      `INSERT INTO payments.payment_history (
         environment,
         type,
         status,
         subject_type,
         subject_id,
         stripe_customer_id,
         customer_email_snapshot,
         stripe_payment_intent_id,
         stripe_invoice_id,
         stripe_charge_id,
         stripe_refund_id,
         stripe_subscription_id,
         stripe_product_id,
         stripe_price_id,
         amount,
         currency,
         description,
         refunded_at,
         stripe_created_at,
         raw
       )
       VALUES ($1, 'refund', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (environment, stripe_refund_id)
         WHERE stripe_refund_id IS NOT NULL
       DO UPDATE SET
         status = EXCLUDED.status,
         subject_type = EXCLUDED.subject_type,
         subject_id = EXCLUDED.subject_id,
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         customer_email_snapshot = EXCLUDED.customer_email_snapshot,
         stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id,
         stripe_invoice_id = EXCLUDED.stripe_invoice_id,
         stripe_charge_id = EXCLUDED.stripe_charge_id,
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         stripe_product_id = EXCLUDED.stripe_product_id,
         stripe_price_id = EXCLUDED.stripe_price_id,
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         description = EXCLUDED.description,
         refunded_at = EXCLUDED.refunded_at,
         stripe_created_at = EXCLUDED.stripe_created_at,
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        environment,
        mappedStatus,
        context?.subjectType ?? null,
        context?.subjectId ?? null,
        context?.stripeCustomerId ?? null,
        context?.customerEmailSnapshot ?? null,
        stripePaymentIntentId,
        context?.stripeInvoiceId ?? null,
        stripeChargeId,
        refund.id,
        context?.stripeSubscriptionId ?? null,
        context?.stripeProductId ?? null,
        context?.stripePriceId ?? null,
        refund.amount,
        refund.currency,
        refund.description ?? refund.reason ?? context?.description ?? null,
        mappedStatus === 'refunded' ? this.fromStripeTimestamp(refund.created) : null,
        this.fromStripeTimestamp(refund.created),
        refund,
      ]
    );
  }

  private async updatePaymentHistoryFromRefundedCharge(
    environment: StripeEnvironment,
    charge: StripeCharge
  ): Promise<void> {
    const stripePaymentIntentId = this.getStripeObjectId(charge.payment_intent);
    const refundedAt = this.getLatestRefundCreatedAt(charge) ?? new Date();

    await this.getPool().query(
      `UPDATE payments.payment_history
       SET amount_refunded = $4,
           status = CASE WHEN $5 THEN 'refunded' ELSE 'partially_refunded' END,
           refunded_at = $6,
           updated_at = NOW()
       WHERE environment = $1
         AND type <> 'refund'
         AND (
           ($2::TEXT IS NOT NULL AND stripe_payment_intent_id = $2)
           OR ($3::TEXT IS NOT NULL AND stripe_charge_id = $3)
         )`,
      [
        environment,
        stripePaymentIntentId,
        charge.id,
        charge.amount_refunded,
        charge.refunded,
        refundedAt,
      ]
    );
  }

  private async findPaymentHistoryContextForRefund(
    environment: StripeEnvironment,
    stripePaymentIntentId: string | null,
    stripeChargeId: string | null
  ): Promise<PaymentHistoryContext | null> {
    if (!stripePaymentIntentId && !stripeChargeId) {
      return null;
    }

    const result = await this.getPool().query(
      `SELECT
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         stripe_customer_id AS "stripeCustomerId",
         customer_email_snapshot AS "customerEmailSnapshot",
         stripe_invoice_id AS "stripeInvoiceId",
         stripe_subscription_id AS "stripeSubscriptionId",
         stripe_product_id AS "stripeProductId",
         stripe_price_id AS "stripePriceId",
         description
       FROM payments.payment_history
       WHERE environment = $1
         AND type <> 'refund'
         AND (
           ($2::TEXT IS NOT NULL AND stripe_payment_intent_id = $2)
           OR ($3::TEXT IS NOT NULL AND stripe_charge_id = $3)
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [environment, stripePaymentIntentId, stripeChargeId]
    );

    return (result.rows[0] as PaymentHistoryContext | undefined) ?? null;
  }

  private async upsertSubscriptionProjection(
    environment: StripeEnvironment,
    subscription: StripeSubscription
  ): Promise<SubscriptionProjectionResult> {
    const stripeCustomerId = this.getStripeObjectId(subscription.customer);
    if (!stripeCustomerId) {
      return { synced: false, unmapped: false };
    }

    const subject = await this.resolveSubscriptionSubject(
      environment,
      subscription,
      stripeCustomerId
    );

    if (!subject) {
      logger.warn('Stripe subscription projection is missing InsForge billing subject', {
        environment,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId,
      });
    }

    const client = await this.getPool().connect();
    const subscriptionItems = subscription.items?.data ?? [];

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO payments.subscriptions (
           environment,
           stripe_subscription_id,
           stripe_customer_id,
           subject_type,
           subject_id,
           status,
           current_period_start,
           current_period_end,
           cancel_at_period_end,
           cancel_at,
           canceled_at,
           trial_start,
           trial_end,
           latest_invoice_id,
           metadata,
           raw,
           synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
         ON CONFLICT (environment, stripe_subscription_id) DO UPDATE SET
           stripe_customer_id = EXCLUDED.stripe_customer_id,
           subject_type = EXCLUDED.subject_type,
           subject_id = EXCLUDED.subject_id,
           status = EXCLUDED.status,
           current_period_start = EXCLUDED.current_period_start,
           current_period_end = EXCLUDED.current_period_end,
           cancel_at_period_end = EXCLUDED.cancel_at_period_end,
           cancel_at = EXCLUDED.cancel_at,
           canceled_at = EXCLUDED.canceled_at,
           trial_start = EXCLUDED.trial_start,
           trial_end = EXCLUDED.trial_end,
           latest_invoice_id = EXCLUDED.latest_invoice_id,
           metadata = EXCLUDED.metadata,
           raw = EXCLUDED.raw,
           synced_at = NOW(),
           updated_at = NOW()`,
        [
          environment,
          subscription.id,
          stripeCustomerId,
          subject?.type ?? null,
          subject?.id ?? null,
          subscription.status,
          this.fromStripeTimestamp(this.getSubscriptionCurrentPeriodStart(subscription)),
          this.fromStripeTimestamp(this.getSubscriptionCurrentPeriodEnd(subscription)),
          subscription.cancel_at_period_end,
          this.fromStripeTimestamp(subscription.cancel_at),
          this.fromStripeTimestamp(subscription.canceled_at),
          this.fromStripeTimestamp(subscription.trial_start),
          this.fromStripeTimestamp(subscription.trial_end),
          this.getStripeObjectId(subscription.latest_invoice),
          subscription.metadata ?? {},
          subscription,
        ]
      );

      for (const item of subscriptionItems) {
        await this.upsertSubscriptionItem(client, environment, subscription.id, item);
      }

      await client.query(
        `DELETE FROM payments.subscription_items
         WHERE environment = $1
           AND stripe_subscription_id = $2
           AND NOT (stripe_subscription_item_id = ANY($3::TEXT[]))`,
        [
          environment,
          subscription.id,
          subscriptionItems.map((item: StripeSubscriptionItem) => item.id),
        ]
      );

      await client.query('COMMIT');
      return { synced: true, unmapped: !subject };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async deleteMissingSyncedSubscriptions(
    environment: StripeEnvironment,
    stripeSubscriptionIds: string[]
  ): Promise<number> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM payments.subscription_items
         WHERE environment = $1
           AND NOT (stripe_subscription_id = ANY($2::TEXT[]))`,
        [environment, stripeSubscriptionIds]
      );
      const result = await client.query(
        `DELETE FROM payments.subscriptions
         WHERE environment = $1
           AND NOT (stripe_subscription_id = ANY($2::TEXT[]))`,
        [environment, stripeSubscriptionIds]
      );
      await client.query('COMMIT');

      return result.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertSubscriptionItem(
    client: PoolClient,
    environment: StripeEnvironment,
    stripeSubscriptionId: string,
    item: StripeSubscriptionItem
  ): Promise<void> {
    await client.query(
      `INSERT INTO payments.subscription_items (
         environment,
         stripe_subscription_item_id,
         stripe_subscription_id,
         stripe_product_id,
         stripe_price_id,
         quantity,
         metadata,
         raw
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (environment, stripe_subscription_item_id) DO UPDATE SET
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         stripe_product_id = EXCLUDED.stripe_product_id,
         stripe_price_id = EXCLUDED.stripe_price_id,
         quantity = EXCLUDED.quantity,
         metadata = EXCLUDED.metadata,
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        environment,
        item.id,
        stripeSubscriptionId,
        this.getStripeObjectId(item.price?.product),
        item.price?.id ?? null,
        item.quantity ?? null,
        item.metadata ?? {},
        item,
      ]
    );
  }

  private async findSubjectForStripeCustomer(
    environment: StripeEnvironment,
    stripeCustomerId: string
  ): Promise<BillingSubject | null> {
    const mapping = await this.findStripeCustomerMappingByCustomerId(environment, stripeCustomerId);
    if (!mapping) {
      return null;
    }

    return { type: mapping.subjectType, id: mapping.subjectId };
  }

  private async resolveSubscriptionSubject(
    environment: StripeEnvironment,
    subscription: StripeSubscription,
    stripeCustomerId: string
  ): Promise<BillingSubject | null> {
    return (
      this.getBillingSubjectFromMetadata(subscription.metadata) ??
      (await this.findSubjectForStripeCustomer(environment, stripeCustomerId))
    );
  }

  private async resolveInvoiceSubject(
    environment: StripeEnvironment,
    invoice: StripeInvoice,
    stripeCustomerId: string | null
  ): Promise<BillingSubject | null> {
    const parentMetadata = invoice.parent?.subscription_details?.metadata;

    return (
      this.getBillingSubjectFromMetadata(parentMetadata) ??
      this.getBillingSubjectFromMetadata(invoice.metadata) ??
      (stripeCustomerId
        ? await this.findSubjectForStripeCustomer(environment, stripeCustomerId)
        : null)
    );
  }

  private getInvoiceSubscriptionId(invoice: StripeInvoice): string | null {
    const parentSubscription = this.getStripeObjectId(
      invoice.parent?.subscription_details?.subscription
    );
    if (parentSubscription) {
      return parentSubscription;
    }

    for (const line of invoice.lines?.data ?? []) {
      const lineSubscription =
        this.getStripeObjectId(line.subscription) ??
        this.getStripeObjectId(line.parent?.subscription_item_details?.subscription) ??
        this.getStripeObjectId(line.parent?.invoice_item_details?.subscription);
      if (lineSubscription) {
        return lineSubscription;
      }
    }

    return null;
  }

  private getInvoicePaymentIntentId(invoice: StripeInvoice): string | null {
    for (const payment of invoice.payments?.data ?? []) {
      const paymentIntentId = this.getStripeObjectId(payment.payment.payment_intent);
      if (paymentIntentId) {
        return paymentIntentId;
      }
    }

    return null;
  }

  private getInvoiceLineItemProductId(
    line: StripeInvoice['lines']['data'][number] | null
  ): string | null {
    return line?.pricing?.price_details?.product ?? null;
  }

  private getInvoiceLineItemPriceId(
    line: StripeInvoice['lines']['data'][number] | null
  ): string | null {
    return this.getStripeObjectId(line?.pricing?.price_details?.price);
  }

  private mapRefundStatus(status: string | null): PaymentHistoryStatus {
    if (status === 'failed' || status === 'canceled') {
      return 'failed';
    }

    if (status === 'succeeded') {
      return 'refunded';
    }

    return 'pending';
  }

  private getLatestRefundCreatedAt(charge: StripeCharge): Date | null {
    const refundTimestamps =
      charge.refunds?.data
        ?.map((refund) => refund.created)
        .filter((value): value is number => typeof value === 'number') ?? [];

    if (refundTimestamps.length === 0) {
      return null;
    }

    return this.fromStripeTimestamp(Math.max(...refundTimestamps));
  }

  private getBillingSubjectFromMetadata(
    metadata: Record<string, string> | null | undefined
  ): BillingSubject | null {
    const subjectType = metadata?.[SUBJECT_METADATA_KEYS.type];
    const subjectId = metadata?.[SUBJECT_METADATA_KEYS.id];

    if (!subjectType || !subjectId) {
      return null;
    }

    return { type: subjectType, id: subjectId };
  }

  private getSubscriptionCurrentPeriodStart(subscription: StripeSubscription): number | null {
    const starts = subscription.items.data
      .map((item) => item.current_period_start)
      .filter((value): value is number => typeof value === 'number');

    return starts.length > 0 ? Math.min(...starts) : null;
  }

  private getSubscriptionCurrentPeriodEnd(subscription: StripeSubscription): number | null {
    const ends = subscription.items.data
      .map((item) => item.current_period_end)
      .filter((value): value is number => typeof value === 'number');

    return ends.length > 0 ? Math.max(...ends) : null;
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

  private getStripeObjectType(value: unknown): string | null {
    if (
      value &&
      typeof value === 'object' &&
      'object' in value &&
      typeof value.object === 'string'
    ) {
      return value.object;
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
      webhookEndpointId: row.webhookEndpointId ?? null,
      webhookEndpointUrl: row.webhookEndpointUrl ?? null,
      webhookConfiguredAt: this.toISOStringOrNull(row.webhookConfiguredAt),
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

  private normalizeStripeProduct(
    product: StripeProduct,
    environment: StripeEnvironment
  ): StripeProductMirror {
    return {
      environment,
      stripeProductId: product.id,
      name: product.name,
      description: product.description ?? null,
      active: product.active,
      defaultPriceId: this.getStripeObjectId(product.default_price),
      metadata: product.metadata ?? {},
      syncedAt: new Date().toISOString(),
    };
  }

  private normalizePriceRow(row: StripePriceRow): StripePriceMirror {
    return {
      ...row,
      unitAmount: row.unitAmount === null ? null : Number(row.unitAmount),
      unitAmountDecimal: this.normalizeStripeDecimal(row.unitAmountDecimal),
      syncedAt: this.toISOString(row.syncedAt),
    };
  }

  private normalizeStripePrice(
    price: StripePrice,
    environment: StripeEnvironment
  ): StripePriceMirror {
    return {
      environment,
      stripePriceId: price.id,
      stripeProductId: this.getStripeObjectId(price.product),
      active: price.active,
      currency: price.currency,
      unitAmount: price.unit_amount ?? null,
      unitAmountDecimal: this.normalizeStripeDecimal(price.unit_amount_decimal),
      type: price.type,
      lookupKey: price.lookup_key ?? null,
      billingScheme: price.billing_scheme ?? null,
      taxBehavior: price.tax_behavior ?? null,
      recurringInterval: price.recurring?.interval ?? null,
      recurringIntervalCount: price.recurring?.interval_count ?? null,
      metadata: price.metadata ?? {},
      syncedAt: new Date().toISOString(),
    };
  }

  private normalizeCheckoutSession(
    checkoutSession: StripeCheckoutSession,
    environment: StripeEnvironment
  ): CreateCheckoutSessionResponse['checkoutSession'] {
    return {
      environment,
      stripeCheckoutSessionId: checkoutSession.id,
      mode: checkoutSession.mode === 'subscription' ? 'subscription' : 'payment',
      url: checkoutSession.url ?? null,
      status: checkoutSession.status ?? null,
      paymentStatus: checkoutSession.payment_status ?? null,
      stripeCustomerId: this.getStripeObjectId(checkoutSession.customer),
      stripePaymentIntentId: this.getStripeObjectId(checkoutSession.payment_intent),
      stripeSubscriptionId: this.getStripeObjectId(checkoutSession.subscription),
    };
  }

  private normalizePaymentHistoryRow(
    row: PaymentHistoryRow
  ): ListPaymentHistoryResponse['paymentHistory'][number] {
    return {
      environment: row.environment,
      type: row.type,
      status: row.status,
      subjectType: row.subjectType ?? null,
      subjectId: row.subjectId ?? null,
      stripeCustomerId: row.stripeCustomerId ?? null,
      customerEmailSnapshot: row.customerEmailSnapshot ?? null,
      stripeCheckoutSessionId: row.stripeCheckoutSessionId ?? null,
      stripePaymentIntentId: row.stripePaymentIntentId ?? null,
      stripeInvoiceId: row.stripeInvoiceId ?? null,
      stripeChargeId: row.stripeChargeId ?? null,
      stripeRefundId: row.stripeRefundId ?? null,
      stripeSubscriptionId: row.stripeSubscriptionId ?? null,
      stripeProductId: row.stripeProductId ?? null,
      stripePriceId: row.stripePriceId ?? null,
      amount: row.amount === null ? null : Number(row.amount),
      amountRefunded: row.amountRefunded === null ? null : Number(row.amountRefunded),
      currency: row.currency ?? null,
      description: row.description ?? null,
      paidAt: this.toISOStringOrNull(row.paidAt),
      failedAt: this.toISOStringOrNull(row.failedAt),
      refundedAt: this.toISOStringOrNull(row.refundedAt),
      stripeCreatedAt: this.toISOStringOrNull(row.stripeCreatedAt),
      createdAt: this.toISOString(row.createdAt),
      updatedAt: this.toISOString(row.updatedAt),
    };
  }

  private normalizeSubscriptionRow(
    row: StripeSubscriptionRow
  ): Omit<ListSubscriptionsResponse['subscriptions'][number], 'items'> {
    return {
      environment: row.environment,
      stripeSubscriptionId: row.stripeSubscriptionId,
      stripeCustomerId: row.stripeCustomerId,
      subjectType: row.subjectType ?? null,
      subjectId: row.subjectId ?? null,
      status: row.status,
      currentPeriodStart: this.toISOStringOrNull(row.currentPeriodStart),
      currentPeriodEnd: this.toISOStringOrNull(row.currentPeriodEnd),
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      cancelAt: this.toISOStringOrNull(row.cancelAt),
      canceledAt: this.toISOStringOrNull(row.canceledAt),
      trialStart: this.toISOStringOrNull(row.trialStart),
      trialEnd: this.toISOStringOrNull(row.trialEnd),
      latestInvoiceId: row.latestInvoiceId ?? null,
      metadata: row.metadata ?? {},
      syncedAt: this.toISOString(row.syncedAt),
      createdAt: this.toISOString(row.createdAt),
      updatedAt: this.toISOString(row.updatedAt),
    };
  }

  private normalizeSubscriptionItemRow(
    row: StripeSubscriptionItemRow
  ): NonNullable<ListSubscriptionsResponse['subscriptions'][number]['items']>[number] {
    return {
      environment: row.environment,
      stripeSubscriptionItemId: row.stripeSubscriptionItemId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      stripeProductId: row.stripeProductId ?? null,
      stripePriceId: row.stripePriceId ?? null,
      quantity: row.quantity === null ? null : Number(row.quantity),
      metadata: row.metadata ?? {},
      createdAt: this.toISOString(row.createdAt),
      updatedAt: this.toISOString(row.updatedAt),
    };
  }

  private normalizeWebhookEventRow(row: StripeWebhookEventRow): StripeWebhookEvent {
    return {
      environment: row.environment,
      stripeEventId: row.stripeEventId,
      eventType: row.eventType,
      livemode: row.livemode,
      stripeAccountId: row.stripeAccountId ?? null,
      objectType: row.objectType ?? null,
      objectId: row.objectId ?? null,
      processingStatus: row.processingStatus,
      attemptCount: Number(row.attemptCount),
      lastError: row.lastError ?? null,
      receivedAt: this.toISOString(row.receivedAt),
      processedAt: this.toISOStringOrNull(row.processedAt),
      createdAt: this.toISOString(row.createdAt),
      updatedAt: this.toISOString(row.updatedAt),
    };
  }

  private normalizeStripeDecimal(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const stringValue = String(value);

    try {
      const parsed = JSON.parse(stringValue) as unknown;
      if (typeof parsed === 'string') {
        return parsed;
      }
    } catch {
      // Decimal values are usually plain strings; only legacy mirrored rows need JSON unwrapping.
    }

    return stringValue;
  }

  private createEmptyConnection(environment: StripeEnvironment): StripeConnectionRow {
    return {
      environment,
      status: 'unconfigured',
      stripeAccountId: null,
      stripeAccountEmail: null,
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

  private toISOStringOrNull(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    return this.toISOString(value);
  }

  private toISOString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
  }

  private fromStripeTimestamp(value: number | null | undefined): Date | null {
    return value ? new Date(value * 1000) : null;
  }
}
