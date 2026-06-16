import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { getBillingSubjectFromProviderAttributes } from '@/services/payments/helpers.js';
import { RazorpayConfigService } from '@/services/payments/razorpay/config.service.js';
import { PaymentWebhookEventStore } from '@/services/payments/webhook-event-store.js';
import {
  RazorpayTransactionService,
  type RazorpayTransactionStatus,
} from '@/services/payments/razorpay/transaction.service.js';
import { AppError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';
import type {
  RazorpayInvoice,
  RazorpayPayment,
  RazorpayRefund,
  RazorpaySubscription,
  RazorpayWebhookPayload,
} from '@/providers/payments/razorpay.provider.js';
import type { RazorpayEnvironment } from '@/types/payments.js';
import { ERROR_CODES, type RazorpayWebhookResponse } from '@insforge/shared-schemas';

export type RazorpayWebhookProcessingStatus = 'pending' | 'processed' | 'failed' | 'ignored';

export interface RazorpayWebhookEventRow {
  id: string;
  environment: RazorpayEnvironment;
  eventId: string;
  eventType: string;
  processingStatus: RazorpayWebhookProcessingStatus;
  attemptCount: number;
  lastError: string | null;
  receivedAt: Date | string;
  processedAt: Date | string | null;
}

interface ShouldProcessResult {
  shouldProcess: boolean;
  row: RazorpayWebhookEventRow;
}

interface RazorpayPaymentContext {
  invoice?: RazorpayInvoice | null;
  subscription?: RazorpaySubscription | null;
}

export class RazorpayWebhookService {
  private static instance: RazorpayWebhookService;
  private pool: Pool | null = null;
  private readonly configService = RazorpayConfigService.getInstance();
  private readonly transactionService = RazorpayTransactionService.getInstance();
  private readonly eventStore = PaymentWebhookEventStore.getInstance();

  static getInstance(): RazorpayWebhookService {
    if (!RazorpayWebhookService.instance) {
      RazorpayWebhookService.instance = new RazorpayWebhookService();
    }
    return RazorpayWebhookService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  async handleRazorpayWebhook(
    environment: RazorpayEnvironment,
    rawBodyBuffer: Buffer,
    signature: string,
    headerEventId?: string
  ): Promise<RazorpayWebhookResponse> {
    const webhookSecret = await this.configService.getRazorpayWebhookSecret(environment);
    if (!webhookSecret) {
      throw new AppError(
        `Razorpay ${environment} webhook secret is not configured`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const provider = await this.configService.createRazorpayProvider(environment);
    const isValid = provider.verifyWebhookSignature(rawBodyBuffer, signature, webhookSecret);
    if (!isValid) {
      throw new AppError(
        `Invalid Razorpay webhook signature. Confirm the Razorpay Dashboard webhook secret matches the ${environment} InsForge webhook setup and the webhook URL points to /api/webhooks/razorpay/${environment}.`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const payload = this.parseWebhookPayload(rawBodyBuffer.toString('utf8'));
    const eventId = this.getWebhookEventId(payload, headerEventId);
    const eventStart = await this.recordWebhookEventStart(
      environment,
      eventId,
      payload.event,
      payload
    );

    if (!eventStart.shouldProcess) {
      return { received: true, handled: false };
    }

    const handled = await this.processRecordedRazorpayWebhookEvent(environment, eventId, payload);

    return { received: true, handled };
  }

  private async processRecordedRazorpayWebhookEvent(
    environment: RazorpayEnvironment,
    eventId: string,
    payload: RazorpayWebhookPayload
  ): Promise<boolean> {
    if (!this.isHandledEvent(payload.event)) {
      await this.markWebhookEvent(environment, eventId, 'ignored', null);
      return false;
    }

    let handled: boolean;

    try {
      handled = await this.applyRazorpayWebhookEvent(environment, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markWebhookEvent(environment, eventId, 'failed', message).catch((markError) => {
        logger.error('Failed to mark Razorpay webhook event as failed', {
          environment,
          eventId,
          error: markError instanceof Error ? markError.message : String(markError),
          originalError: message,
        });
      });
      throw error;
    }

    try {
      await this.markWebhookEvent(environment, eventId, handled ? 'processed' : 'ignored', null);
      return handled;
    } catch (error) {
      logger.error('Failed to finalize Razorpay webhook event after processing', {
        environment,
        eventId,
        handled,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Record the start of a webhook event. Returns whether it should be processed
   * (i.e. it's not a duplicate already successfully processed).
   */
  async recordWebhookEventStart(
    environment: RazorpayEnvironment,
    eventId: string,
    eventType: string,
    payload: RazorpayWebhookPayload
  ): Promise<ShouldProcessResult> {
    const result = await this.eventStore.recordStart({
      provider: 'razorpay',
      environment,
      eventId,
      eventType,
      livemode: environment === 'live',
      payload,
    });

    if (!result.shouldProcess) {
      logger.info('Razorpay webhook event already processed or currently processing; skipping', {
        environment,
        eventId,
        eventType,
      });
    }

    return result;
  }

  async markWebhookEvent(
    environment: RazorpayEnvironment,
    eventId: string,
    status: RazorpayWebhookProcessingStatus,
    error: string | null
  ): Promise<RazorpayWebhookEventRow> {
    return this.eventStore.mark('razorpay', environment, eventId, status, error);
  }

  private parseWebhookPayload(rawBody: string): RazorpayWebhookPayload {
    try {
      return JSON.parse(rawBody) as RazorpayWebhookPayload;
    } catch {
      throw new AppError('Invalid Razorpay webhook payload', 400, ERROR_CODES.INVALID_INPUT);
    }
  }

  private getWebhookEventId(payload: RazorpayWebhookPayload, headerEventId: string | undefined) {
    if (headerEventId) {
      return headerEventId;
    }

    const entityType = payload.contains?.[0];
    const entityId = this.getPayloadEntityId(payload, entityType);
    return `${payload.account_id}.${payload.event}.${entityId}.${payload.created_at}`;
  }

  private getPayloadEntityId(
    payload: RazorpayWebhookPayload,
    entityType: string | undefined
  ): string {
    if (!entityType) {
      return 'no_entity';
    }

    const entityPayload = payload.payload[entityType];
    if (!this.isRecord(entityPayload)) {
      return 'no_entity';
    }

    const entity = entityPayload.entity;
    if (!this.isRecord(entity) || typeof entity.id !== 'string') {
      return 'no_entity';
    }

    return entity.id;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isHandledEvent(event: string): boolean {
    return HANDLED_RAZORPAY_EVENTS.has(event);
  }

  private async applyRazorpayWebhookEvent(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload
  ): Promise<boolean> {
    switch (payload.event) {
      case 'payment.authorized':
      case 'payment.captured':
        return this.handlePaymentUpsert(environment, payload, payload.event);
      case 'payment.failed':
        return this.handlePaymentUpsert(environment, payload, payload.event);
      case 'refund.created':
      case 'refund.processed':
      case 'refund.failed':
        return this.handleRefund(environment, payload, payload.event);
      case 'subscription.created':
      case 'subscription.activated':
      case 'subscription.charged':
      case 'subscription.updated':
      case 'subscription.cancelled':
      case 'subscription.paused':
      case 'subscription.resumed':
      case 'subscription.halted':
      case 'subscription.completed':
      case 'subscription.expired':
        return this.handleSubscriptionUpsert(environment, payload);
      case 'invoice.paid':
      case 'invoice.expired':
        return this.handleInvoice(environment, payload, payload.event);
      case 'order.paid':
        return this.handleOrderPaid(environment, payload);
      default:
        return false;
    }
  }

  private async handlePaymentUpsert(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload,
    event: string,
    context: RazorpayPaymentContext = {}
  ): Promise<boolean> {
    const payment = this.getEntity<RazorpayPayment>(payload, 'payment');
    if (!payment) {
      logger.warn('[Razorpay Webhook] payment event: no payment entity', { event });
      return false;
    }

    const subscription =
      context.subscription ?? this.getEntity<RazorpaySubscription>(payload, 'subscription');
    const invoice = context.invoice ?? this.getEntity<RazorpayInvoice>(payload, 'invoice') ?? null;
    if (subscription && event.startsWith('payment.')) {
      await this.upsertSubscription(environment, subscription);
    }

    const invoiceNotes = invoice ? this.normalizeNotes(invoice.notes) : null;
    const subscriptionNotes = subscription ? this.normalizeNotes(subscription.notes) : null;
    const subjectFallback =
      (invoiceNotes ? getBillingSubjectFromProviderAttributes(invoiceNotes) : null) ??
      (subscriptionNotes ? getBillingSubjectFromProviderAttributes(subscriptionNotes) : null);
    const descriptionFallback =
      invoice?.description ??
      invoice?.line_items?.[0]?.name ??
      invoice?.line_items?.[0]?.description ??
      null;

    const status = await this.transactionService.upsertPaymentTransaction(environment, payment, {
      invoiceId: invoice?.id ?? null,
      orderId: invoice?.order_id ?? null,
      subscriptionId: subscription?.id ?? invoice?.subscription_id ?? null,
      subjectFallback,
      descriptionFallback,
    });

    await this.updateOrderFromPayment(environment, payment);

    logger.info('[Razorpay Webhook] Payment upserted', {
      environment,
      paymentId: payment.id,
      status,
    });
    return true;
  }

  private async handleRefund(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload,
    event: string
  ): Promise<boolean> {
    const refund = this.getEntity<RazorpayRefund>(payload, 'refund');
    if (!refund) {
      logger.warn('[Razorpay Webhook] refund event: no refund entity', { event });
      return false;
    }

    const refundStatus = this.mapRefundStatus(refund, event);
    await this.transactionService.upsertRefundTransaction(environment, refund, refundStatus);

    logger.info('[Razorpay Webhook] Refund processed', {
      environment,
      refundId: refund.id,
      paymentId: refund.payment_id,
      event,
    });
    return true;
  }

  private mapRefundStatus(refund: RazorpayRefund, event: string): RazorpayTransactionStatus {
    if (event === 'refund.failed' || refund.status === 'failed') {
      return 'failed';
    }

    if (event === 'refund.processed' || refund.status === 'processed') {
      return 'refunded';
    }

    return 'pending';
  }

  private async handleSubscriptionUpsert(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload
  ): Promise<boolean> {
    const subscription = this.getEntity<RazorpaySubscription>(payload, 'subscription');
    if (!subscription) {
      logger.warn('[Razorpay Webhook] subscription event: no subscription entity', {
        event: payload.event,
      });
      return false;
    }

    if (payload.event === 'subscription.charged') {
      const payment = this.getEntity<RazorpayPayment>(payload, 'payment');
      if (payment) {
        await this.handlePaymentUpsert(environment, payload, payload.event);
      }
    }

    await this.upsertSubscription(environment, subscription);

    logger.info('[Razorpay Webhook] Subscription upserted', {
      environment,
      subscriptionId: subscription.id,
      status: subscription.status,
      event: payload.event,
    });
    return true;
  }

  private async upsertSubscription(
    environment: RazorpayEnvironment,
    subscription: RazorpaySubscription
  ): Promise<void> {
    const notes = this.normalizeNotes(subscription.notes);
    const subject =
      getBillingSubjectFromProviderAttributes(notes) ??
      (await this.resolveSubjectFromCustomerMapping(environment, subscription.customer_id));

    await this.getPool().query(
      `INSERT INTO payments.razorpay_subscriptions (
         environment, subscription_id, plan_id, customer_id,
         subject_type, subject_id, status,
         current_start, current_end, ended_at,
         quantity, charge_at, start_at, end_at,
         total_count, auth_attempts, paid_count, remaining_count,
         short_url, has_scheduled_changes, change_scheduled_at,
         offer_id, notes, raw, provider_created_at, synced_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW())
       ON CONFLICT (environment, subscription_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         customer_id = EXCLUDED.customer_id,
         subject_type = EXCLUDED.subject_type,
         subject_id = EXCLUDED.subject_id,
         status = EXCLUDED.status,
         current_start = EXCLUDED.current_start,
         current_end = EXCLUDED.current_end,
         ended_at = EXCLUDED.ended_at,
         quantity = EXCLUDED.quantity,
         charge_at = EXCLUDED.charge_at,
         start_at = EXCLUDED.start_at,
         end_at = EXCLUDED.end_at,
         total_count = EXCLUDED.total_count,
         auth_attempts = EXCLUDED.auth_attempts,
         paid_count = EXCLUDED.paid_count,
         remaining_count = EXCLUDED.remaining_count,
         short_url = EXCLUDED.short_url,
         has_scheduled_changes = EXCLUDED.has_scheduled_changes,
         change_scheduled_at = EXCLUDED.change_scheduled_at,
         offer_id = EXCLUDED.offer_id,
         notes = EXCLUDED.notes,
         raw = EXCLUDED.raw,
         provider_created_at = EXCLUDED.provider_created_at,
         synced_at = NOW(),
         updated_at = NOW()`,
      [
        environment,
        subscription.id,
        subscription.plan_id,
        subscription.customer_id ?? null,
        subject?.type ?? null,
        subject?.id ?? null,
        subscription.status,
        this.fromRazorpayTimestamp(subscription.current_start),
        this.fromRazorpayTimestamp(subscription.current_end),
        this.fromRazorpayTimestamp(subscription.ended_at),
        subscription.quantity ?? null,
        this.fromRazorpayTimestamp(subscription.charge_at),
        this.fromRazorpayTimestamp(subscription.start_at),
        this.fromRazorpayTimestamp(subscription.end_at),
        subscription.total_count ?? null,
        subscription.auth_attempts ?? null,
        subscription.paid_count ?? null,
        subscription.remaining_count ?? null,
        subscription.short_url ?? null,
        subscription.has_scheduled_changes,
        this.fromRazorpayTimestamp(subscription.change_scheduled_at),
        subscription.offer_id ?? null,
        notes,
        subscription,
        this.fromRazorpayTimestamp(subscription.created_at),
      ]
    );

    if (subject && subscription.customer_id) {
      await this.upsertCustomerMapping(environment, subject, subscription.customer_id);
    }
  }

  private async handleInvoice(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload,
    event: string
  ): Promise<boolean> {
    const invoice = this.getEntity<RazorpayInvoice>(payload, 'invoice');
    if (!invoice) {
      logger.warn('[Razorpay Webhook] invoice event: no invoice entity', { event });
      return false;
    }

    const payment = this.getEntity<RazorpayPayment>(payload, 'payment');
    const subscription = this.getEntity<RazorpaySubscription>(payload, 'subscription');
    let handled = false;
    if (payment) {
      await this.handlePaymentUpsert(environment, payload, event, { invoice, subscription });
      handled = true;
    }

    if (subscription) {
      await this.upsertSubscription(environment, subscription);
      handled = true;
    }

    if (!payment) {
      await this.transactionService.upsertInvoiceTransaction(environment, invoice, event);
      handled = true;
    }

    logger.info('[Razorpay Webhook] Invoice processed', {
      environment,
      invoiceId: invoice.id,
      event,
    });
    return handled;
  }

  private async handleOrderPaid(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload
  ): Promise<boolean> {
    const payment = this.getEntity<RazorpayPayment>(payload, 'payment');
    if (!payment) {
      logger.warn('[Razorpay Webhook] order.paid: no payment entity');
      return false;
    }

    await this.handlePaymentUpsert(environment, payload, 'order.paid');
    logger.info('[Razorpay Webhook] Order paid processed', { environment });
    return true;
  }

  private async resolveSubjectFromCustomerMapping(
    environment: RazorpayEnvironment,
    customerId: string | null
  ): Promise<{ type: string; id: string } | null> {
    if (!customerId) {
      return null;
    }

    const result = await this.getPool().query(
      `SELECT subject_type AS "type", subject_id AS "id"
       FROM payments.customer_mappings
       WHERE provider = 'razorpay'
         AND environment = $1
         AND provider_customer_id = $2
       LIMIT 1`,
      [environment, customerId]
    );

    return (result.rows[0] as { type: string; id: string } | undefined) ?? null;
  }

  private async updateOrderFromPayment(
    environment: RazorpayEnvironment,
    payment: RazorpayPayment
  ): Promise<void> {
    if (!payment.order_id) {
      return;
    }

    const isCapturedPayment =
      payment.captured || payment.status === 'captured' || payment.status === 'refunded';

    await this.getPool().query(
      `UPDATE payments.razorpay_orders
       SET status = CASE
             WHEN $3 THEN 'paid'
             WHEN status = 'paid' THEN status
             ELSE 'attempted'
           END,
           amount_paid = CASE WHEN $3 THEN $4 ELSE amount_paid END,
           amount_due = CASE WHEN $3 THEN GREATEST(amount - $4, 0) ELSE amount_due END,
           verified_payment_id = CASE
             WHEN $3 THEN COALESCE(verified_payment_id, $5)
             ELSE verified_payment_id
           END,
           raw = jsonb_set(COALESCE(NULLIF(raw, '{}'::JSONB), '{}'::JSONB), '{latest_payment}', $6::JSONB, true),
           updated_at = NOW()
       WHERE environment = $1
         AND order_id = $2`,
      [
        environment,
        payment.order_id,
        isCapturedPayment,
        payment.amount,
        payment.id,
        JSON.stringify(payment),
      ]
    );
  }

  private async upsertCustomerMapping(
    environment: RazorpayEnvironment,
    subject: { type: string; id: string },
    customerId: string
  ): Promise<void> {
    await this.getPool().query(
      `INSERT INTO payments.customer_mappings (
         provider,
         environment,
         subject_type,
         subject_id,
         provider_customer_id
       )
       VALUES ('razorpay', $1, $2, $3, $4)
       ON CONFLICT (provider, environment, subject_type, subject_id) DO UPDATE SET
         provider_customer_id = EXCLUDED.provider_customer_id,
         updated_at = NOW()`,
      [environment, subject.type, subject.id, customerId]
    );
  }

  private getEntity<T>(payload: RazorpayWebhookPayload, key: string): T | null {
    const wrapper = payload.payload[key];
    if (!this.isRecord(wrapper)) {
      return null;
    }

    const entity = wrapper.entity;
    if (!this.isRecord(entity)) {
      return null;
    }

    return entity as T;
  }

  private normalizeNotes(
    notes: Record<string, string | number | boolean> | undefined | null
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(notes ?? {}).map(([key, value]) => [key, String(value)])
    );
  }

  private fromRazorpayTimestamp(unixSeconds: number | null | undefined): Date | null {
    return unixSeconds ? new Date(unixSeconds * 1000) : null;
  }
}

const HANDLED_RAZORPAY_EVENTS = new Set([
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'subscription.created',
  'subscription.activated',
  'subscription.charged',
  'subscription.updated',
  'subscription.cancelled',
  'subscription.paused',
  'subscription.resumed',
  'subscription.halted',
  'subscription.completed',
  'subscription.expired',
  'refund.created',
  'refund.processed',
  'refund.failed',
  'invoice.paid',
  'invoice.expired',
  'order.paid',
]);
