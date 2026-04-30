import type { Pool } from 'pg';
import { AppError } from '@/api/middlewares/error.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { StripeProvider } from '@/providers/payments/stripe.provider.js';
import { PaymentConfigService } from '@/services/payments/payment-config.service.js';
import {
  PaymentCheckoutService,
  type CheckoutUserContext,
} from '@/services/payments/payment-checkout.service.js';
import { PaymentCustomerPortalService } from '@/services/payments/payment-customer-portal.service.js';
import { PaymentHistoryService } from '@/services/payments/payment-history.service.js';
import { PaymentProductService } from '@/services/payments/payment-product.service.js';
import { PaymentPriceService } from '@/services/payments/payment-price.service.js';
import { PaymentSubscriptionService } from '@/services/payments/payment-subscription.service.js';
import { PaymentWebhookService } from '@/services/payments/payment-webhook.service.js';
import {
  withPaymentSessionAdvisoryLock,
  type PaymentSessionAdvisoryLockMode,
} from '@/services/payments/payments-advisory-lock.js';
import {
  CHECKOUT_SESSION_METADATA_KEY,
  CHECKOUT_MODE_METADATA_KEY,
  SUBJECT_METADATA_KEYS,
  WEBHOOK_SECRET_BY_ENVIRONMENT,
} from '@/services/payments/constants.js';
import {
  buildStripeIdempotencyKey,
  fromStripeTimestamp,
  getBillingSubjectFromMetadata,
  getStripeObjectId,
  normalizePriceRow,
  normalizeProductRow,
} from '@/services/payments/helpers.js';
import logger from '@/utils/logger.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  STRIPE_ENVIRONMENTS,
  type StripeCheckoutSession,
  type StripeEnvironment,
  type StripeEvent,
  type StripeCharge,
  type StripeInvoice,
  type StripePaymentIntent,
  type StripePriceRow,
  type StripeProductRow,
  type StripeRefund,
  type StripeSubscription,
} from '@/types/payments.js';
import type {
  ArchivePaymentPriceResponse,
  ConfigurePaymentWebhookResponse,
  CreatePaymentPriceRequest,
  GetPaymentsStatusResponse,
  GetPaymentPriceResponse,
  ListPaymentCatalogResponse,
  ListPaymentPricesRequest,
  ListPaymentPricesResponse,
  ListPaymentProductsRequest,
  StripeConnection,
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
  CreateCustomerPortalSessionRequest,
  CreateCustomerPortalSessionResponse,
  CheckoutSession,
  BillingSubject,
  StripeWebhookResponse,
  ListPaymentHistoryRequest,
  ListPaymentHistoryResponse,
  ListSubscriptionsRequest,
  ListSubscriptionsResponse,
  SyncPaymentsRequest,
  SyncPaymentsResponse,
  SyncPaymentsEnvironmentResult,
  SyncPaymentsSubscriptionsSummary,
} from '@insforge/shared-schemas';

export class PaymentService {
  private static instance: PaymentService;
  private pool: Pool | null = null;
  private readonly configService = PaymentConfigService.getInstance();
  private readonly checkoutService = PaymentCheckoutService.getInstance();
  private readonly customerPortalService = PaymentCustomerPortalService.getInstance();
  private readonly historyService = PaymentHistoryService.getInstance();
  private readonly productService = PaymentProductService.getInstance();
  private readonly priceService = PaymentPriceService.getInstance();
  private readonly subscriptionService = PaymentSubscriptionService.getInstance();
  private readonly webhookService = PaymentWebhookService.getInstance();

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

  private async withSessionAdvisoryLock<T>(
    lockName: string,
    task: () => Promise<T>,
    mode: PaymentSessionAdvisoryLockMode = 'exclusive'
  ): Promise<T> {
    return withPaymentSessionAdvisoryLock(this.getPool(), lockName, task, mode);
  }

  private async withEnvironmentLock<T>(
    environment: StripeEnvironment,
    task: () => Promise<T>
  ): Promise<T> {
    return this.withSessionAdvisoryLock(`payments_environment_${environment}`, task);
  }

  private async withEnvironmentSharedLock<T>(
    environment: StripeEnvironment,
    task: () => Promise<T>
  ): Promise<T> {
    return this.withSessionAdvisoryLock(`payments_environment_${environment}`, task, 'shared');
  }

  private async withCheckoutIdempotencyLock<T>(
    environment: StripeEnvironment,
    idempotencyKey: string | null | undefined,
    task: () => Promise<T>
  ): Promise<T> {
    if (!idempotencyKey) {
      return task();
    }

    return this.withSessionAdvisoryLock(`payments_checkout_${environment}_${idempotencyKey}`, task);
  }

  async getConfig(): Promise<GetPaymentsConfigResponse> {
    return this.configService.getConfig();
  }

  async setStripeSecretKey(environment: StripeEnvironment, secretKey: string): Promise<void> {
    await this.configService.setStripeSecretKey(
      environment,
      secretKey,
      async (syncEnvironment, provider) => {
        await this.syncPaymentsEnvironmentUnlocked(syncEnvironment, provider, false);
      }
    );
  }

  async removeStripeSecretKey(environment: StripeEnvironment): Promise<boolean> {
    return this.configService.removeStripeSecretKey(environment);
  }

  async seedStripeKeysFromEnv(): Promise<void> {
    await this.configService.seedStripeKeysFromEnv(async (environment, provider) => {
      await this.syncPaymentsEnvironmentUnlocked(environment, provider, false);
    });
  }

  async getStatus(): Promise<GetPaymentsStatusResponse> {
    return this.configService.getStatus();
  }

  async configureWebhook(environment: StripeEnvironment): Promise<ConfigurePaymentWebhookResponse> {
    const connection = await this.configService.configureManagedStripeWebhook(environment);
    return { connection };
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
      products: (productsResult.rows as StripeProductRow[]).map((row) => normalizeProductRow(row)),
      prices: (pricesResult.rows as StripePriceRow[]).map((row) => normalizePriceRow(row)),
    };
  }

  async listProducts(input: ListPaymentProductsRequest): Promise<ListPaymentProductsResponse> {
    return this.productService.listProducts(input);
  }

  async getProduct(
    environment: StripeEnvironment,
    stripeProductId: string
  ): Promise<GetPaymentProductResponse> {
    return this.productService.getProduct(environment, stripeProductId);
  }

  async listPrices(filters: ListPaymentPricesRequest): Promise<ListPaymentPricesResponse> {
    return this.priceService.listPrices(filters);
  }

  async getPrice(
    environment: StripeEnvironment,
    stripePriceId: string
  ): Promise<GetPaymentPriceResponse> {
    return this.priceService.getPrice(environment, stripePriceId);
  }

  async listPaymentHistory(input: ListPaymentHistoryRequest): Promise<ListPaymentHistoryResponse> {
    return this.historyService.listPaymentHistory(input);
  }

  async listSubscriptions(input: ListSubscriptionsRequest): Promise<ListSubscriptionsResponse> {
    return this.subscriptionService.listSubscriptions(input);
  }

  private async syncSubscriptionsWithProviderUnlocked(
    environment: StripeEnvironment,
    provider: StripeProvider
  ): Promise<SyncPaymentsSubscriptionsSummary> {
    return this.subscriptionService.syncSubscriptionsWithProvider(environment, provider);
  }

  async createProduct(input: CreatePaymentProductRequest): Promise<MutatePaymentProductResponse> {
    return this.productService.createProduct(input);
  }

  async updateProduct(
    stripeProductId: string,
    input: UpdatePaymentProductRequest
  ): Promise<MutatePaymentProductResponse> {
    return this.productService.updateProduct(stripeProductId, input);
  }

  async deleteProduct(
    environment: StripeEnvironment,
    stripeProductId: string
  ): Promise<DeletePaymentProductResponse> {
    return this.productService.deleteProduct(environment, stripeProductId);
  }

  async createPrice(input: CreatePaymentPriceRequest): Promise<MutatePaymentPriceResponse> {
    return this.priceService.createPrice(input);
  }

  async updatePrice(
    stripePriceId: string,
    input: UpdatePaymentPriceRequest
  ): Promise<MutatePaymentPriceResponse> {
    return this.priceService.updatePrice(stripePriceId, input);
  }

  async archivePrice(
    environment: StripeEnvironment,
    stripePriceId: string
  ): Promise<ArchivePaymentPriceResponse> {
    return this.priceService.archivePrice(environment, stripePriceId);
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionRequest,
    user: CheckoutUserContext
  ): Promise<CreateCheckoutSessionResponse> {
    if (input.mode === 'subscription' && !input.subject) {
      throw new AppError(
        'Subscription checkout requires a billing subject',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const runCheckout = async (): Promise<CreateCheckoutSessionResponse> => {
      const baseMetadata = this.buildStripeMetadata(input.metadata, input.subject, input.mode);
      const checkoutRecord = await this.checkoutService.insertInitializedCheckoutSession(
        input,
        baseMetadata,
        user
      );
      if (
        checkoutRecord.existingCheckoutSession &&
        this.isUsableCheckoutSession(checkoutRecord.existingCheckoutSession)
      ) {
        return { checkoutSession: checkoutRecord.existingCheckoutSession };
      }

      const metadata = {
        ...baseMetadata,
        [CHECKOUT_SESSION_METADATA_KEY]: checkoutRecord.id,
      };

      try {
        const provider = await this.configService.createStripeProvider(input.environment);
        const customerId = await this.resolveCheckoutCustomer(input);
        const customerCreation =
          input.mode === 'payment' && input.subject && !customerId ? 'always' : undefined;
        const checkoutSession = await provider.createCheckoutSession({
          mode: input.mode,
          lineItems: input.lineItems,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
          customerId,
          customerEmail: customerId ? null : input.customerEmail,
          ...(customerCreation ? { customerCreation } : {}),
          clientReferenceId: checkoutRecord.id,
          metadata,
          idempotencyKey: buildStripeIdempotencyKey(
            input.environment,
            'checkout_session',
            input.idempotencyKey ?? checkoutRecord.id
          ),
        });

        return {
          checkoutSession: await this.checkoutService.markCheckoutSessionOpen(
            checkoutRecord.id,
            checkoutSession,
            metadata
          ),
        };
      } catch (error) {
        await this.checkoutService
          .markCheckoutSessionFailed(checkoutRecord.id, error)
          .catch((markError) => {
            logger.warn('Failed to mark Stripe checkout session as failed', {
              environment: input.environment,
              checkoutSessionId: checkoutRecord.id,
              error: markError instanceof Error ? markError.message : String(markError),
            });
          });
        throw error;
      }
    };

    return this.withEnvironmentSharedLock(input.environment, () =>
      this.withCheckoutIdempotencyLock(input.environment, input.idempotencyKey, runCheckout)
    );
  }

  async createCustomerPortalSession(
    input: CreateCustomerPortalSessionRequest,
    user: CheckoutUserContext
  ): Promise<CreateCustomerPortalSessionResponse> {
    if (user.role === 'anon') {
      throw new AppError(
        'Customer portal sessions require an authenticated user',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS
      );
    }

    const portalRecord = await this.customerPortalService.insertInitializedCustomerPortalSession(
      input,
      user
    );

    try {
      const mapping = await this.findStripeCustomerMapping(input.environment, input.subject);
      if (!mapping) {
        throw new AppError(
          'No Stripe customer is mapped to this billing subject',
          404,
          ERROR_CODES.NOT_FOUND
        );
      }

      const provider = await this.configService.createStripeProvider(input.environment);
      const portalSession = await provider.createCustomerPortalSession({
        customerId: mapping.stripeCustomerId,
        returnUrl: input.returnUrl,
        configuration: input.configuration,
      });

      if (!portalSession.url) {
        throw new AppError(
          'Stripe did not return a customer portal URL',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      const customerPortalSession =
        await this.customerPortalService.markCustomerPortalSessionCreated(
          portalRecord.id,
          mapping.stripeCustomerId,
          portalSession
        );

      return { customerPortalSession };
    } catch (error) {
      await this.customerPortalService
        .markCustomerPortalSessionFailed(portalRecord.id, error)
        .catch((markError) => {
          logger.warn('Failed to mark Stripe customer portal session as failed', {
            environment: input.environment,
            customerPortalSessionId: portalRecord.id,
            error: markError instanceof Error ? markError.message : String(markError),
          });
        });
      throw error;
    }
  }

  private isUsableCheckoutSession(checkoutSession: CheckoutSession): boolean {
    return Boolean(checkoutSession.stripeCheckoutSessionId && checkoutSession.url);
  }

  async handleStripeWebhook(
    environment: StripeEnvironment,
    rawBody: Buffer,
    signature: string
  ): Promise<StripeWebhookResponse> {
    const webhookSecret = await this.configService.getStripeWebhookSecret(environment);
    if (!webhookSecret) {
      throw new AppError(
        `${WEBHOOK_SECRET_BY_ENVIRONMENT[environment]} is not configured`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const provider = await this.configService.createStripeProvider(environment);
    const event = provider.constructWebhookEvent(rawBody, signature, webhookSecret);
    const eventStart = await this.webhookService.recordWebhookEventStart(environment, event);

    if (!eventStart.shouldProcess) {
      return {
        received: true,
        handled: false,
        event: this.webhookService.normalizeWebhookEventRow(eventStart.row),
      };
    }

    try {
      const handled = await this.applyStripeWebhookEvent(environment, event, provider);
      const row = await this.webhookService.markWebhookEvent(
        environment,
        event.id,
        handled ? 'processed' : 'ignored',
        null
      );

      return {
        received: true,
        handled,
        event: this.webhookService.normalizeWebhookEventRow(row),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.webhookService.markWebhookEvent(environment, event.id, 'failed', message);
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
        secretKey = await this.configService.getStripeSecretKey(environment);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const connection = await this.configService.recordConnectionStatus(
          environment,
          'error',
          message
        );
        return { environment, connection, subscriptions: null };
      }

      if (!secretKey) {
        const connection = await this.configService.recordConnectionStatus(
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
      connection = await this.configService.getConnection(environment);

      return { environment, connection, subscriptions };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Stripe payments sync failed', { environment, error: message });
      const connection = await this.configService.recordConnectionStatus(
        environment,
        'error',
        message
      );
      return { environment, connection, subscriptions: null };
    }
  }

  private async syncCatalogWithProviderUnlocked(
    environment: StripeEnvironment,
    provider: StripeProvider,
    checkAccountChange: boolean
  ): Promise<StripeConnection> {
    const snapshot = await provider.syncCatalog();
    const currentStripeAccountId = checkAccountChange
      ? await this.configService.getCurrentStripeAccountId(environment)
      : snapshot.account.id;
    const accountChanged = currentStripeAccountId !== snapshot.account.id;
    const webhookSetup = accountChanged
      ? await this.configService.tryRecreateManagedStripeWebhook(provider, environment)
      : null;

    await this.configService.writeSnapshot(
      environment,
      snapshot,
      new Date(),
      accountChanged,
      webhookSetup
    );

    return this.configService.getConnection(environment);
  }

  private async resolveCheckoutCustomer(
    input: CreateCheckoutSessionRequest
  ): Promise<string | null> {
    if (!input.subject) {
      return null;
    }

    const existing = await this.findStripeCustomerMapping(input.environment, input.subject);
    if (existing) {
      return existing.stripeCustomerId;
    }

    return null;
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

  private async upsertStripeCustomerMappingFromCheckout(
    environment: StripeEnvironment,
    checkoutSession: StripeCheckoutSession
  ): Promise<boolean> {
    const subject = getBillingSubjectFromMetadata(checkoutSession.metadata);
    const stripeCustomerId = getStripeObjectId(checkoutSession.customer);
    if (!subject || !stripeCustomerId) {
      return false;
    }

    await this.getPool().query(
      `INSERT INTO payments.stripe_customer_mappings (
         environment,
         subject_type,
         subject_id,
         stripe_customer_id
       )
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (environment, subject_type, subject_id) DO UPDATE SET
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         updated_at = NOW()`,
      [environment, subject.type, subject.id, stripeCustomerId]
    );

    return true;
  }

  private buildStripeMetadata(
    metadata: Record<string, string> | undefined,
    subject: BillingSubject | undefined,
    checkoutMode?: 'payment' | 'subscription'
  ): Record<string, string> {
    const reservedKey = Object.keys(metadata ?? {}).find((key) => key.startsWith('insforge_'));
    if (reservedKey) {
      throw new AppError(
        `Metadata key ${reservedKey} is reserved for InsForge`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

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

  private async applyStripeWebhookEvent(
    environment: StripeEnvironment,
    event: StripeEvent,
    provider: StripeProvider
  ): Promise<boolean> {
    const eventCreatedAt = fromStripeTimestamp(event.created);

    switch (event.type) {
      case 'checkout.session.completed': {
        const checkoutSession = event.data.object as StripeCheckoutSession;
        const [checkoutRow, mapped, historyHandled] = await Promise.all([
          this.checkoutService.updateCheckoutSessionFromStripe(
            environment,
            checkoutSession,
            'completed'
          ),
          this.upsertStripeCustomerMappingFromCheckout(environment, checkoutSession),
          this.historyService.processCheckoutSessionCompleted(
            environment,
            checkoutSession,
            undefined,
            eventCreatedAt
          ),
        ]);

        return Boolean(checkoutRow) || mapped || historyHandled;
      }
      case 'checkout.session.async_payment_succeeded': {
        const checkoutSession = event.data.object as StripeCheckoutSession;
        const [checkoutRow, mapped, historyHandled] = await Promise.all([
          this.checkoutService.updateCheckoutSessionFromStripe(
            environment,
            checkoutSession,
            'completed'
          ),
          this.upsertStripeCustomerMappingFromCheckout(environment, checkoutSession),
          this.historyService.processCheckoutSessionCompleted(
            environment,
            checkoutSession,
            'succeeded',
            eventCreatedAt
          ),
        ]);

        return Boolean(checkoutRow) || mapped || historyHandled;
      }
      case 'checkout.session.async_payment_failed': {
        const checkoutSession = event.data.object as StripeCheckoutSession;
        const checkoutRow = await this.checkoutService.updateCheckoutSessionFromStripe(
          environment,
          checkoutSession,
          'completed'
        );
        const historyHandled = await this.historyService.processCheckoutSessionCompleted(
          environment,
          checkoutSession,
          'failed'
        );

        return Boolean(checkoutRow) || historyHandled;
      }
      case 'checkout.session.expired':
        return Boolean(
          await this.checkoutService.updateCheckoutSessionFromStripe(
            environment,
            event.data.object as StripeCheckoutSession,
            'expired'
          )
        );
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await this.historyService.upsertInvoicePaymentHistory(
          environment,
          event.data.object as StripeInvoice,
          'succeeded'
        );
        return true;
      case 'invoice.payment_failed':
        await this.historyService.upsertInvoicePaymentHistory(
          environment,
          event.data.object as StripeInvoice,
          'failed'
        );
        return true;
      case 'payment_intent.succeeded':
        return this.historyService.processPaymentIntentHistory(
          environment,
          event.data.object as StripePaymentIntent,
          'succeeded'
        );
      case 'payment_intent.payment_failed':
        return this.historyService.processPaymentIntentHistory(
          environment,
          event.data.object as StripePaymentIntent,
          'failed'
        );
      case 'charge.refunded':
        await this.historyService.updatePaymentHistoryFromRefundedCharge(
          environment,
          event.data.object as StripeCharge
        );
        return true;
      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed':
        await this.historyService.upsertRefundPaymentHistory(
          environment,
          event.data.object as StripeRefund,
          () => this.loadRefundStripeContext(provider, event.data.object as StripeRefund)
        );
        return true;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        return (
          await this.subscriptionService.upsertSubscriptionProjection(
            environment,
            event.data.object as StripeSubscription,
            provider
          )
        ).synced;
      default:
        return false;
    }
  }

  private async loadRefundStripeContext(
    provider: StripeProvider,
    refund: StripeRefund
  ): Promise<{
    paymentIntent: StripePaymentIntent | null;
    charge: StripeCharge | null;
    invoice: StripeInvoice | null;
  }> {
    const refundPaymentIntentId = getStripeObjectId(refund.payment_intent);
    const refundChargeId = getStripeObjectId(refund.charge);
    const [refundPaymentIntent, charge] = await Promise.all([
      refundPaymentIntentId ? provider.retrievePaymentIntent(refundPaymentIntentId) : null,
      refundChargeId ? provider.retrieveCharge(refundChargeId) : null,
    ]);
    const paymentIntentId =
      refundPaymentIntentId ?? getStripeObjectId(charge?.payment_intent) ?? null;
    const paymentIntent =
      refundPaymentIntent ??
      (paymentIntentId ? await provider.retrievePaymentIntent(paymentIntentId) : null);
    const invoice = paymentIntentId
      ? await provider.retrieveInvoiceByPaymentIntent(paymentIntentId)
      : null;

    return { paymentIntent, charge, invoice };
  }
}
