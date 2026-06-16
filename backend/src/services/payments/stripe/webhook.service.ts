import type { Pool } from 'pg';
import { AppError } from '@/utils/errors.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { StripeConfigService } from '@/services/payments/stripe/config.service.js';
import { StripeCheckoutService } from '@/services/payments/stripe/checkout.service.js';
import { PaymentCustomerService } from '@/services/payments/payment-customer.service.js';
import { StripeTransactionService } from '@/services/payments/stripe/transaction.service.js';
import { StripeSubscriptionService } from '@/services/payments/stripe/subscription.service.js';
import { getStripeWebhookSecretName } from '@/services/payments/stripe/constants.js';
import { WebhookStoreService } from '@/services/payments/webhook-store.service.js';
import {
  fromStripeTimestamp,
  getBillingSubjectFromProviderAttributes,
  getStripeObjectId,
} from '@/services/payments/helpers.js';
import { toISOString, toISOStringOrNull } from '@/utils/dates.js';
import logger from '@/utils/logger.js';
import type {
  StripeCharge,
  StripeCheckoutSession,
  StripeEnvironment,
  StripeEvent,
  StripeInvoice,
  StripePaymentIntent,
  StripeRefund,
  StripeSubscription,
  StripeWebhookEventRow,
} from '@/types/payments.js';
import type { StripeProvider } from '@/providers/payments/stripe.provider.js';
import {
  ERROR_CODES,
  type StripeWebhookEvent,
  type StripeWebhookResponse,
} from '@insforge/shared-schemas';

export class StripeWebhookService {
  private static instance: StripeWebhookService;
  private pool: Pool | null = null;
  private readonly configService = StripeConfigService.getInstance();
  private readonly checkoutService = StripeCheckoutService.getInstance();
  private readonly customerService = PaymentCustomerService.getInstance();
  private readonly stripeTransactionService = StripeTransactionService.getInstance();
  private readonly subscriptionService = StripeSubscriptionService.getInstance();
  private readonly webhookStore = WebhookStoreService.getInstance();

  static getInstance(): StripeWebhookService {
    if (!StripeWebhookService.instance) {
      StripeWebhookService.instance = new StripeWebhookService();
    }

    return StripeWebhookService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async handleStripeWebhook(
    environment: StripeEnvironment,
    rawBody: Buffer,
    signature: string
  ): Promise<StripeWebhookResponse> {
    const webhookSecret = await this.configService.getStripeWebhookSecret(environment);
    if (!webhookSecret) {
      throw new AppError(
        `${getStripeWebhookSecretName(environment)} is not configured`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const provider = await this.configService.createStripeProvider(environment);
    const event = provider.constructWebhookEvent(rawBody, signature, webhookSecret);
    const eventStart = await this.recordWebhookEventStart(environment, event);

    if (!eventStart.shouldProcess) {
      return {
        received: true,
        handled: false,
        event: this.normalizeWebhookEventRow(eventStart.row),
      };
    }

    let handled: boolean;

    try {
      handled = await this.applyStripeWebhookEvent(environment, event, provider);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markWebhookEvent(environment, event.id, 'failed', message).catch((markError) => {
        logger.error('Failed to mark Stripe webhook event as failed', {
          environment,
          eventId: event.id,
          error: markError instanceof Error ? markError.message : String(markError),
          originalError: message,
        });
      });
      throw error;
    }

    try {
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
      logger.error('Failed to finalize Stripe webhook event after processing', {
        environment,
        eventId: event.id,
        handled,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async recordWebhookEventStart(
    environment: StripeEnvironment,
    event: StripeEvent
  ): Promise<{ row: StripeWebhookEventRow; shouldProcess: boolean }> {
    const object = event.data.object as unknown;
    return this.webhookStore.recordStart({
      provider: 'stripe',
      environment,
      eventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      accountId: typeof event.account === 'string' ? event.account : null,
      objectType: this.getStripeObjectType(object),
      objectId: getStripeObjectId(object),
      payload: event,
    });
  }

  async markWebhookEvent(
    environment: StripeEnvironment,
    eventId: string,
    processingStatus: 'processed' | 'failed' | 'ignored',
    error: string | null
  ): Promise<StripeWebhookEventRow> {
    return this.webhookStore.mark('stripe', environment, eventId, processingStatus, error);
  }

  normalizeWebhookEventRow(row: StripeWebhookEventRow): StripeWebhookEvent {
    return {
      environment: row.environment,
      eventId: row.eventId,
      eventType: row.eventType,
      livemode: row.livemode,
      accountId: row.accountId ?? null,
      objectType: row.objectType ?? null,
      objectId: row.objectId ?? null,
      processingStatus: row.processingStatus,
      attemptCount: Number(row.attemptCount),
      lastError: row.lastError ?? null,
      receivedAt: toISOString(row.receivedAt),
      processedAt: toISOStringOrNull(row.processedAt),
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  private async upsertStripeCustomerMappingFromCheckout(
    environment: StripeEnvironment,
    checkoutSession: StripeCheckoutSession
  ): Promise<boolean> {
    const subject = getBillingSubjectFromProviderAttributes(checkoutSession.metadata);
    const customerId = getStripeObjectId(checkoutSession.customer);
    if (!subject || !customerId) {
      return false;
    }

    await this.getPool().query(
      `INSERT INTO payments.customer_mappings (
         provider,
         environment,
         subject_type,
         subject_id,
         provider_customer_id
       )
       VALUES ('stripe', $1, $2, $3, $4)
       ON CONFLICT (provider, environment, subject_type, subject_id) DO UPDATE SET
         provider_customer_id = EXCLUDED.provider_customer_id,
         updated_at = NOW()`,
      [environment, subject.type, subject.id, customerId]
    );

    return true;
  }

  private async deleteStripeCustomerMappingsByCustomerId(
    environment: StripeEnvironment,
    customerId: string
  ): Promise<boolean> {
    const result = await this.getPool().query(
      `DELETE FROM payments.customer_mappings
       WHERE provider = 'stripe'
         AND environment = $1
         AND provider_customer_id = $2`,
      [environment, customerId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  private async applyStripeWebhookEvent(
    environment: StripeEnvironment,
    event: StripeEvent,
    provider: StripeProvider
  ): Promise<boolean> {
    const eventCreatedAt = fromStripeTimestamp(event.created);

    switch (event.type) {
      case 'customer.created':
      case 'customer.updated':
        return this.customerService.upsertCustomerProjection(
          environment,
          event.data.object as { id: string; deleted?: boolean }
        );
      case 'customer.deleted': {
        const customer = event.data.object as { id?: string; deleted?: boolean };
        if (!customer.id) {
          return false;
        }

        const deletedCustomer = {
          id: customer.id,
          deleted: customer.deleted,
        };

        const [projectionHandled, mappingsDeleted] = await Promise.all([
          this.customerService.upsertCustomerProjection(environment, deletedCustomer),
          this.deleteStripeCustomerMappingsByCustomerId(environment, customer.id),
        ]);

        return projectionHandled || mappingsDeleted;
      }
      case 'checkout.session.completed': {
        const checkoutSession = event.data.object as StripeCheckoutSession;
        const [checkoutRow, mapped, transactionHandled] = await Promise.all([
          this.checkoutService.updateCheckoutSessionFromStripe(
            environment,
            checkoutSession,
            'completed'
          ),
          this.upsertStripeCustomerMappingFromCheckout(environment, checkoutSession),
          this.stripeTransactionService.processCheckoutSessionCompleted(
            environment,
            checkoutSession,
            undefined,
            eventCreatedAt
          ),
        ]);

        return Boolean(checkoutRow) || mapped || transactionHandled;
      }
      case 'checkout.session.async_payment_succeeded': {
        const checkoutSession = event.data.object as StripeCheckoutSession;
        const [checkoutRow, mapped, transactionHandled] = await Promise.all([
          this.checkoutService.updateCheckoutSessionFromStripe(
            environment,
            checkoutSession,
            'completed'
          ),
          this.upsertStripeCustomerMappingFromCheckout(environment, checkoutSession),
          this.stripeTransactionService.processCheckoutSessionCompleted(
            environment,
            checkoutSession,
            'succeeded',
            eventCreatedAt
          ),
        ]);

        return Boolean(checkoutRow) || mapped || transactionHandled;
      }
      case 'checkout.session.async_payment_failed': {
        const checkoutSession = event.data.object as StripeCheckoutSession;
        const checkoutRow = await this.checkoutService.updateCheckoutSessionFromStripe(
          environment,
          checkoutSession,
          'completed'
        );
        const transactionHandled =
          await this.stripeTransactionService.processCheckoutSessionCompleted(
            environment,
            checkoutSession,
            'failed',
            eventCreatedAt
          );

        return Boolean(checkoutRow) || transactionHandled;
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
        await this.stripeTransactionService.upsertInvoiceTransaction(
          environment,
          event.data.object as StripeInvoice,
          'succeeded'
        );
        return true;
      case 'invoice.payment_failed':
        await this.stripeTransactionService.upsertInvoiceTransaction(
          environment,
          event.data.object as StripeInvoice,
          'failed'
        );
        return true;
      case 'payment_intent.succeeded':
        return this.stripeTransactionService.processPaymentIntentTransaction(
          environment,
          event.data.object as StripePaymentIntent,
          'succeeded'
        );
      case 'payment_intent.payment_failed':
        return this.stripeTransactionService.processPaymentIntentTransaction(
          environment,
          event.data.object as StripePaymentIntent,
          'failed'
        );
      case 'charge.refunded':
        await this.stripeTransactionService.updateTransactionFromRefundedCharge(
          environment,
          event.data.object as StripeCharge
        );
        return true;
      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed':
        await this.stripeTransactionService.upsertRefundTransaction(
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
}
