/**
 * RazorpayWebhookHandlerService
 *
 * Handles each Razorpay webhook event type individually, updating only the
 * rows that are relevant to the event. This replaces the previous approach of
 * triggering a full background sync on every incoming webhook.
 *
 * Design rules:
 *  - Every handler extracts its data purely from the webhook payload.
 *  - No extra Razorpay API calls are made inside a handler.
 *  - Each write is idempotent (UPSERT / DO UPDATE).
 *  - The caller (`RazorpayWebhookService`) marks the event processed/failed.
 */

import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { getBillingSubjectFromMetadata } from '@/services/payments/helpers.js';
import type {
  RazorpayWebhookPayload,
  RazorpayPayment,
  RazorpaySubscription,
  RazorpayInvoice,
} from '@/providers/payments/razorpay.provider.js';
import type { RazorpayEnvironment } from '@/types/payments.js';
import logger from '@/utils/logger.js';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function ts(unixSeconds: number | null | undefined): Date | null {
  return unixSeconds ? new Date(unixSeconds * 1000) : null;
}

function normalizeMetadata(
  notes: Record<string, string | number | boolean> | undefined | null
): Record<string, string> {
  return Object.fromEntries(Object.entries(notes ?? {}).map(([k, v]) => [k, String(v)]));
}

function getEntity<T>(payload: RazorpayWebhookPayload, key: string): T | null {
  const wrapper = payload.payload[key];
  if (typeof wrapper !== 'object' || wrapper === null) {
    return null;
  }
  const entity = (wrapper as Record<string, unknown>).entity;
  if (typeof entity !== 'object' || entity === null) {
    return null;
  }
  return entity as T;
}

// ---------------------------------------------------------------------------
// Payment status mapping (same logic as payment-activity.service.ts)
// ---------------------------------------------------------------------------

type RazorpayPaymentActivityStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

function mapPaymentStatus(rzpStatus: RazorpayPayment['status']): RazorpayPaymentActivityStatus {
  switch (rzpStatus) {
    case 'captured':
      return 'succeeded';
    case 'authorized':
    case 'created':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'refunded':
      return 'refunded';
    default:
      return 'pending';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RazorpayWebhookHandlerService {
  private static instance: RazorpayWebhookHandlerService;
  private pool: Pool | null = null;

  static getInstance(): RazorpayWebhookHandlerService {
    if (!RazorpayWebhookHandlerService.instance) {
      RazorpayWebhookHandlerService.instance = new RazorpayWebhookHandlerService();
    }
    return RazorpayWebhookHandlerService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Dispatch the incoming webhook payload to the correct per-event handler.
   * Returns true if a handler ran, false if the event type is not handled.
   */
  async dispatch(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload
  ): Promise<boolean> {
    const { event } = payload;

    logger.info('[Razorpay Webhook] Dispatching event', { environment, event });

    // ── Payment events ──────────────────────────────────────────────────────
    if (event === 'payment.authorized' || event === 'payment.captured') {
      return this.handlePaymentUpsert(environment, payload, event);
    }
    if (event === 'payment.failed') {
      return this.handlePaymentFailed(environment, payload);
    }

    // ── Refund events ────────────────────────────────────────────────────────
    if (event === 'refund.created' || event === 'refund.failed') {
      return this.handleRefund(environment, payload, event);
    }

    // ── Subscription events ──────────────────────────────────────────────────
    if (
      event === 'subscription.created' ||
      event === 'subscription.activated' ||
      event === 'subscription.charged' ||
      event === 'subscription.updated' ||
      event === 'subscription.cancelled' ||
      event === 'subscription.paused' ||
      event === 'subscription.resumed' ||
      event === 'subscription.halted' ||
      event === 'subscription.completed' ||
      event === 'subscription.expired'
    ) {
      return this.handleSubscriptionUpsert(environment, payload);
    }

    // ── Invoice events ────────────────────────────────────────────────────────
    if (event === 'invoice.paid' || event === 'invoice.expired') {
      return this.handleInvoice(environment, payload, event);
    }

    // ── Order events ──────────────────────────────────────────────────────────
    if (event === 'order.paid') {
      return this.handleOrderPaid(environment, payload);
    }

    logger.info('[Razorpay Webhook] Unhandled event type, ignoring', { environment, event });
    return false;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Payment handlers
  // ───────────────────────────────────────────────────────────────────────────

  private async handlePaymentUpsert(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload,
    event: string
  ): Promise<boolean> {
    const payment = getEntity<RazorpayPayment>(payload, 'payment');
    if (!payment) {
      logger.warn('[Razorpay Webhook] payment.authorized/captured: no payment entity', { event });
      return false;
    }

    // If the payment event also carries a subscription entity, upsert the
    // subscription so `subscription_charged` status is reflected immediately.
    const subscription = getEntity<RazorpaySubscription>(payload, 'subscription');
    if (subscription && event.startsWith('payment.')) {
      await this.upsertSubscription(environment, subscription);
    }

    const status = mapPaymentStatus(payment.status);
    const type = payment.invoice_id ? 'subscription_invoice' : 'one_time_payment';
    const paidAt = status === 'succeeded' ? ts(payment.created_at) : null;

    await this.getPool().query(
      `INSERT INTO payments.razorpay_payment_activity (
         environment, type, status,
         customer_id, customer_email_snapshot,
         payment_id, invoice_id, order_id,
         subscription_id,
         amount, amount_refunded, currency, description,
         paid_at, failed_at, refunded_at, provider_created_at, raw
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (environment, payment_id)
         WHERE payment_id IS NOT NULL AND type <> 'refund'
       DO UPDATE SET
         type                   = EXCLUDED.type,
         status                 = EXCLUDED.status,
         customer_id            = EXCLUDED.customer_id,
         customer_email_snapshot= EXCLUDED.customer_email_snapshot,
         invoice_id             = EXCLUDED.invoice_id,
         order_id               = EXCLUDED.order_id,
         subscription_id        = EXCLUDED.subscription_id,
         amount                 = EXCLUDED.amount,
         amount_refunded        = EXCLUDED.amount_refunded,
         currency               = EXCLUDED.currency,
         description            = EXCLUDED.description,
         paid_at                = COALESCE(EXCLUDED.paid_at, payments.razorpay_payment_activity.paid_at),
         failed_at              = EXCLUDED.failed_at,
         refunded_at            = EXCLUDED.refunded_at,
         provider_created_at    = EXCLUDED.provider_created_at,
         raw                    = EXCLUDED.raw,
         updated_at             = NOW()`,
      [
        environment,
        type,
        status,
        payment.customer_id ?? null,
        payment.email ?? null,
        payment.id,
        payment.invoice_id ?? null,
        payment.order_id ?? null,
        subscription?.id ?? null,
        payment.amount,
        payment.amount_refunded ?? 0,
        payment.currency.toLowerCase(),
        payment.description ?? null,
        paidAt,
        null, // failed_at
        null, // refunded_at
        ts(payment.created_at),
        payment,
      ]
    );

    logger.info('[Razorpay Webhook] Payment upserted', {
      environment,
      paymentId: payment.id,
      status,
    });
    return true;
  }

  private async handlePaymentFailed(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload
  ): Promise<boolean> {
    const payment = getEntity<RazorpayPayment>(payload, 'payment');
    if (!payment) {
      logger.warn('[Razorpay Webhook] payment.failed: no payment entity');
      return false;
    }

    const type = payment.invoice_id ? 'subscription_invoice' : 'one_time_payment';

    await this.getPool().query(
      `INSERT INTO payments.razorpay_payment_activity (
         environment, type, status,
         customer_id, customer_email_snapshot,
         payment_id, invoice_id, order_id,
         amount, amount_refunded, currency, description,
         paid_at, failed_at, refunded_at, provider_created_at, raw
       )
       VALUES ($1,$2,'failed',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (environment, payment_id)
         WHERE payment_id IS NOT NULL AND type <> 'refund'
       DO UPDATE SET
         status                 = 'failed',
         customer_id            = EXCLUDED.customer_id,
         customer_email_snapshot= EXCLUDED.customer_email_snapshot,
         invoice_id             = EXCLUDED.invoice_id,
         order_id               = EXCLUDED.order_id,
         failed_at              = EXCLUDED.failed_at,
         raw                    = EXCLUDED.raw,
         updated_at             = NOW()`,
      [
        environment,
        type,
        payment.customer_id ?? null,
        payment.email ?? null,
        payment.id,
        payment.invoice_id ?? null,
        payment.order_id ?? null,
        payment.amount,
        0,
        payment.currency.toLowerCase(),
        payment.description ?? null,
        null, // paid_at
        ts(payment.created_at), // failed_at
        null, // refunded_at
        ts(payment.created_at),
        payment,
      ]
    );

    logger.info('[Razorpay Webhook] Payment marked failed', {
      environment,
      paymentId: payment.id,
    });
    return true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Refund handler
  // ───────────────────────────────────────────────────────────────────────────

  private async handleRefund(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload,
    event: string
  ): Promise<boolean> {
    const refund = getEntity<{
      id: string;
      payment_id: string;
      amount: number;
      currency: string;
      notes: Record<string, string | number>;
      created_at: number;
    }>(payload, 'refund');

    if (!refund) {
      logger.warn('[Razorpay Webhook] refund event: no refund entity', { event });
      return false;
    }

    const refundStatus = event === 'refund.created' ? 'refunded' : 'failed';
    const refundedAt = event === 'refund.created' ? ts(refund.created_at) : null;

    // 1. Insert a separate refund row in the activity table.
    await this.getPool().query(
      `INSERT INTO payments.razorpay_payment_activity (
         environment, type, status,
         payment_id, refund_id,
         amount, amount_refunded, currency,
         refunded_at, provider_created_at, raw
       )
       VALUES ($1,'refund',$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (environment, refund_id)
         WHERE refund_id IS NOT NULL
       DO UPDATE SET
         status           = EXCLUDED.status,
         amount           = EXCLUDED.amount,
         amount_refunded  = EXCLUDED.amount_refunded,
         refunded_at      = COALESCE(EXCLUDED.refunded_at, payments.razorpay_payment_activity.refunded_at),
         raw              = EXCLUDED.raw,
         updated_at       = NOW()`,
      [
        environment,
        refundStatus,
        refund.payment_id,
        refund.id,
        refund.amount,
        refund.amount,
        refund.currency.toLowerCase(),
        refundedAt,
        ts(refund.created_at),
        refund,
      ]
    );

    // 2. Also update the original payment row's amount_refunded + status.
    if (event === 'refund.created') {
      await this.getPool().query(
        `UPDATE payments.razorpay_payment_activity
         SET amount_refunded = COALESCE(amount_refunded, 0) + $3,
             status = CASE WHEN amount <= COALESCE(amount_refunded, 0) + $3 THEN 'refunded' ELSE 'partially_refunded' END,
             refunded_at = COALESCE(refunded_at, $4),
             updated_at = NOW()
         WHERE environment = $1
           AND payment_id = $2
           AND type <> 'refund'`,
        [environment, refund.payment_id, refund.amount, refundedAt]
      );
    }

    logger.info('[Razorpay Webhook] Refund processed', {
      environment,
      refundId: refund.id,
      paymentId: refund.payment_id,
      event,
    });
    return true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Subscription handler
  // ───────────────────────────────────────────────────────────────────────────

  private async handleSubscriptionUpsert(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload
  ): Promise<boolean> {
    const subscription = getEntity<RazorpaySubscription>(payload, 'subscription');
    if (!subscription) {
      logger.warn('[Razorpay Webhook] subscription event: no subscription entity', {
        event: payload.event,
      });
      return false;
    }

    // The subscription_charged event also carries a payment — upsert that too.
    if (payload.event === 'subscription.charged') {
      const payment = getEntity<RazorpayPayment>(payload, 'payment');
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

  /**
   * Shared subscription upsert — called both from the subscription handler and
   * from payment handlers that carry a subscription entity.
   */
  private async upsertSubscription(
    environment: RazorpayEnvironment,
    sub: RazorpaySubscription
  ): Promise<void> {
    const metadata = normalizeMetadata(sub.notes);
    const subject =
      getBillingSubjectFromMetadata(metadata) ??
      (await this.resolveSubjectFromCustomerMapping(environment, sub.customer_id));

    await this.getPool().query(
      `INSERT INTO payments.razorpay_subscriptions (
         environment, subscription_id, plan_id, customer_id,
         subject_type, subject_id, status,
         current_start, current_end, ended_at,
         quantity, charge_at, start_at, end_at,
         total_count, paid_count, remaining_count,
         short_url, has_scheduled_changes, change_scheduled_at,
         offer_id, metadata, raw, provider_created_at, synced_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW())
       ON CONFLICT (environment, subscription_id) DO UPDATE SET
         plan_id               = EXCLUDED.plan_id,
         customer_id           = EXCLUDED.customer_id,
         subject_type          = EXCLUDED.subject_type,
         subject_id            = EXCLUDED.subject_id,
         status                = EXCLUDED.status,
         current_start         = EXCLUDED.current_start,
         current_end           = EXCLUDED.current_end,
         ended_at              = EXCLUDED.ended_at,
         quantity              = EXCLUDED.quantity,
         charge_at             = EXCLUDED.charge_at,
         start_at              = EXCLUDED.start_at,
         end_at                = EXCLUDED.end_at,
         total_count           = EXCLUDED.total_count,
         paid_count            = EXCLUDED.paid_count,
         remaining_count       = EXCLUDED.remaining_count,
         short_url             = EXCLUDED.short_url,
         has_scheduled_changes = EXCLUDED.has_scheduled_changes,
         change_scheduled_at   = EXCLUDED.change_scheduled_at,
         offer_id              = EXCLUDED.offer_id,
         metadata              = EXCLUDED.metadata,
         raw                   = EXCLUDED.raw,
         provider_created_at   = EXCLUDED.provider_created_at,
         synced_at             = NOW(),
         updated_at            = NOW()`,
      [
        environment,
        sub.id,
        sub.plan_id,
        sub.customer_id ?? null,
        subject?.type ?? null,
        subject?.id ?? null,
        sub.status,
        ts(sub.current_start),
        ts(sub.current_end),
        ts(sub.ended_at),
        sub.quantity ?? null,
        ts(sub.charge_at),
        ts(sub.start_at),
        ts(sub.end_at),
        sub.total_count ?? null,
        sub.paid_count ?? null,
        sub.remaining_count ?? null,
        sub.short_url ?? null,
        sub.has_scheduled_changes,
        ts(sub.change_scheduled_at),
        sub.offer_id ?? null,
        metadata,
        sub,
        ts(sub.created_at),
      ]
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Invoice handler
  // ───────────────────────────────────────────────────────────────────────────

  private async handleInvoice(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload,
    event: string
  ): Promise<boolean> {
    const invoice = getEntity<RazorpayInvoice>(payload, 'invoice');
    if (!invoice) {
      logger.warn('[Razorpay Webhook] invoice event: no invoice entity', { event });
      return false;
    }

    // If the invoice carries a payment entity, upsert that as well.
    const payment = getEntity<RazorpayPayment>(payload, 'payment');
    if (payment) {
      await this.handlePaymentUpsert(environment, payload, event);
    }

    // If the invoice carries a subscription, upsert that too.
    const subscription = getEntity<RazorpaySubscription>(payload, 'subscription');
    if (subscription) {
      await this.upsertSubscription(environment, subscription);
    }

    logger.info('[Razorpay Webhook] Invoice processed', {
      environment,
      invoiceId: invoice.id,
      event,
    });
    return true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Order handler
  // ───────────────────────────────────────────────────────────────────────────

  private async handleOrderPaid(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload
  ): Promise<boolean> {
    // order.paid carries a payment entity — upsert that as the source of truth.
    const payment = getEntity<RazorpayPayment>(payload, 'payment');
    if (!payment) {
      logger.warn('[Razorpay Webhook] order.paid: no payment entity');
      return false;
    }

    await this.handlePaymentUpsert(environment, payload, 'order.paid');
    logger.info('[Razorpay Webhook] Order paid processed', { environment });
    return true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

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
}
