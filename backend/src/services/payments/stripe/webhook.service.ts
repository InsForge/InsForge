import type { Pool } from 'pg';
import { AppError } from '@/utils/errors.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { StripeConfigService } from '@/services/payments/stripe/config.service.js';
import { StripeCheckoutService } from '@/services/payments/stripe/checkout.service.js';
import { PaymentCustomerService } from '@/services/payments/payment-customer.service.js';
import { StripeTransactionService } from '@/services/payments/stripe/transaction.service.js';
import { StripeSubscriptionService } from '@/services/payments/stripe/subscription.service.js';
import { getStripeWebhookSecretName } from '@/services/payments/stripe/constants.js';
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

const WEBHOOK_PENDING_RECLAIM_WINDOW_MS = 5 * 60 * 1000;

export class StripeWebhookService {
  private static instance: StripeWebhookService;
  private pool: Pool | null = null;
  private readonly configService = StripeConfigService.getInstance();
  private readonly checkoutService = StripeCheckoutService.getInstance();
  private readonly customerService = PaymentCustomerService.getInstance();
  private readonly stripeTransactionService = StripeTransactionService.getInstance();
  private readonly subscriptionService = StripeSubscriptionService.getInstance();

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
    const objectType = this.getStripeObjectType(object);
    const objectId = getStripeObjectId(object);
    const accountId = typeof event.account === 'string' ? event.account : null;
    const pendingReclaimCutoff = new Date(Date.now() - WEBHOOK_PENDING_RECLAIM_WINDOW_MS);

    const insertResult = await this.getPool().query(
      `INSERT INTO payments.webhook_events (
         provider,
         environment,
         provider_event_id,
         event_type,
         livemode,
         provider_account_id,
         object_type,
         object_id,
         processing_status,
         attempt_count,
         payload
       )
       VALUES ('stripe', $1, $2, $3, $4, $5, $6, $7, 'pending', 1, $8)
       ON CONFLICT (provider, environment, provider_event_id) DO NOTHING
       RETURNING
         environment,
         provider,
         provider_event_id AS "eventId",
         event_type AS "eventType",
         livemode,
         provider_account_id AS "accountId",
         object_type AS "objectType",
         object_id AS "objectId",
         processing_status AS "processingStatus",
         attempt_count AS "attemptCount",
         last_error AS "lastError",
         received_at AS "receivedAt",
         processed_at AS "processedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [environment, event.id, event.type, event.livemode, accountId, objectType, objectId, event]
    );

    const inserted = insertResult.rows[0] as StripeWebhookEventRow | undefined;
    if (inserted) {
      return { row: inserted, shouldProcess: true };
    }

    const retryResult = await this.getPool().query(
      `UPDATE payments.webhook_events
       SET processing_status = 'pending',
           attempt_count = attempt_count + 1,
           last_error = NULL,
           processed_at = NULL,
           payload = $3,
           updated_at = NOW()
       WHERE environment = $1
         AND provider = 'stripe'
         AND provider_event_id = $2
         AND (
           processing_status = 'failed'
           OR (processing_status = 'pending' AND updated_at < $4)
         )
       RETURNING
         environment,
         provider,
         provider_event_id AS "eventId",
         event_type AS "eventType",
         livemode,
         provider_account_id AS "accountId",
         object_type AS "objectType",
         object_id AS "objectId",
         processing_status AS "processingStatus",
         attempt_count AS "attemptCount",
         last_error AS "lastError",
         received_at AS "receivedAt",
         processed_at AS "processedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [environment, event.id, event, pendingReclaimCutoff]
    );

    const retried = retryResult.rows[0] as StripeWebhookEventRow | undefined;
    if (retried) {
      return { row: retried, shouldProcess: true };
    }

    const existingResult = await this.getPool().query(
      `SELECT
         environment,
         provider,
         provider_event_id AS "eventId",
         event_type AS "eventType",
         livemode,
         provider_account_id AS "accountId",
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
         AND provider = 'stripe'
         AND provider_event_id = $2`,
      [environment, event.id]
    );

    return {
      row: existingResult.rows[0] as StripeWebhookEventRow,
      shouldProcess: false,
    };
  }

  async markWebhookEvent(
    environment: StripeEnvironment,
    eventId: string,
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
         AND provider = 'stripe'
         AND provider_event_id = $2
       RETURNING
         environment,
         provider,
         provider_event_id AS "eventId",
         event_type AS "eventType",
         livemode,
         provider_account_id AS "accountId",
         object_type AS "objectType",
         object_id AS "objectId",
         processing_status AS "processingStatus",
         attempt_count AS "attemptCount",
         last_error AS "lastError",
         received_at AS "receivedAt",
         processed_at AS "processedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [environment, eventId, processingStatus, error]
    );

    return result.rows[0] as StripeWebhookEventRow;
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
      case 'invoice.payment_succeeded':
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
