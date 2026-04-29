import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { CHECKOUT_MODE_METADATA_KEY } from '@/services/payments/constants.js';
import {
  fromStripeTimestamp,
  getBillingSubjectFromMetadata,
  getStripeObjectId,
  toISOString,
  toISOStringOrNull,
} from '@/services/payments/helpers.js';
import type {
  PaymentHistoryRow,
  StripeCharge,
  StripeCheckoutSession,
  StripeEnvironment,
  StripeInvoice,
  StripePaymentIntent,
  StripeRefund,
} from '@/types/payments.js';
import type {
  BillingSubject,
  ListPaymentHistoryRequest,
  ListPaymentHistoryResponse,
} from '@insforge/shared-schemas';

type PaymentHistoryStatus = 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded';

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

interface RefundStripeContext {
  paymentIntent: StripePaymentIntent | null;
  charge: StripeCharge | null;
  invoice: StripeInvoice | null;
}

type RefundStripeContextLoader = () => Promise<RefundStripeContext>;

export class PaymentHistoryService {
  private static instance: PaymentHistoryService;
  private pool: Pool | null = null;

  static getInstance(): PaymentHistoryService {
    if (!PaymentHistoryService.instance) {
      PaymentHistoryService.instance = new PaymentHistoryService();
    }

    return PaymentHistoryService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
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

  async processCheckoutSessionCompleted(
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

  async upsertInvoicePaymentHistory(
    environment: StripeEnvironment,
    invoice: StripeInvoice,
    status: 'succeeded' | 'failed'
  ): Promise<void> {
    const stripeCustomerId = getStripeObjectId(invoice.customer);
    const subscriptionId = this.getInvoiceSubscriptionId(invoice);
    const subject = await this.resolveInvoiceSubject(environment, invoice, stripeCustomerId);
    const stripePaymentIntentId = this.getInvoicePaymentIntentId(invoice);
    const firstLine = invoice.lines?.data?.[0] ?? null;
    const stripeProductId = this.getInvoiceLineItemProductId(firstLine);
    const stripePriceId = this.getInvoiceLineItemPriceId(firstLine);
    const paidAt =
      status === 'succeeded'
        ? (fromStripeTimestamp(invoice.status_transitions?.paid_at) ??
          fromStripeTimestamp(invoice.created))
        : null;
    const failedAt = status === 'failed' ? fromStripeTimestamp(invoice.created) : null;

    await this.getPool().query(
      `INSERT INTO payments.payment_history AS payment_history (
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
           AND type <> 'refund'
       DO UPDATE SET
         type = EXCLUDED.type,
         status = EXCLUDED.status,
         subject_type = COALESCE(EXCLUDED.subject_type, payment_history.subject_type),
         subject_id = COALESCE(EXCLUDED.subject_id, payment_history.subject_id),
         stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, payment_history.stripe_customer_id),
         customer_email_snapshot = COALESCE(EXCLUDED.customer_email_snapshot, payment_history.customer_email_snapshot),
         stripe_payment_intent_id = COALESCE(EXCLUDED.stripe_payment_intent_id, payment_history.stripe_payment_intent_id),
         stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, payment_history.stripe_subscription_id),
         stripe_product_id = COALESCE(EXCLUDED.stripe_product_id, payment_history.stripe_product_id),
         stripe_price_id = COALESCE(EXCLUDED.stripe_price_id, payment_history.stripe_price_id),
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
        fromStripeTimestamp(invoice.created),
        invoice,
      ]
    );

    if (status === 'succeeded') {
      await this.refreshOriginalPaymentRefundState(environment, stripePaymentIntentId, null);
    }
  }

  async processPaymentIntentHistory(
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

  async upsertRefundPaymentHistory(
    environment: StripeEnvironment,
    refund: StripeRefund,
    loadStripeContext?: RefundStripeContextLoader
  ): Promise<void> {
    const stripePaymentIntentId = getStripeObjectId(refund.payment_intent);
    const stripeChargeId = getStripeObjectId(refund.charge);
    let context = await this.findPaymentHistoryContextForRefund(
      environment,
      stripePaymentIntentId,
      stripeChargeId
    );

    if (!context && loadStripeContext) {
      const stripeContext = await loadStripeContext();
      await this.upsertOriginalPaymentHistoryForRefund(environment, stripeContext);
      context =
        (await this.findPaymentHistoryContextForRefund(
          environment,
          stripePaymentIntentId,
          stripeChargeId
        )) ?? (await this.buildRefundContextFromStripeContext(environment, stripeContext));
    }

    const mappedStatus = this.mapRefundStatus(refund.status);

    await this.getPool().query(
      `INSERT INTO payments.payment_history AS payment_history (
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
         subject_type = COALESCE(EXCLUDED.subject_type, payment_history.subject_type),
         subject_id = COALESCE(EXCLUDED.subject_id, payment_history.subject_id),
         stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, payment_history.stripe_customer_id),
         customer_email_snapshot = COALESCE(EXCLUDED.customer_email_snapshot, payment_history.customer_email_snapshot),
         stripe_payment_intent_id = COALESCE(EXCLUDED.stripe_payment_intent_id, payment_history.stripe_payment_intent_id),
         stripe_invoice_id = COALESCE(EXCLUDED.stripe_invoice_id, payment_history.stripe_invoice_id),
         stripe_charge_id = COALESCE(EXCLUDED.stripe_charge_id, payment_history.stripe_charge_id),
         stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, payment_history.stripe_subscription_id),
         stripe_product_id = COALESCE(EXCLUDED.stripe_product_id, payment_history.stripe_product_id),
         stripe_price_id = COALESCE(EXCLUDED.stripe_price_id, payment_history.stripe_price_id),
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
        mappedStatus === 'refunded' ? fromStripeTimestamp(refund.created) : null,
        fromStripeTimestamp(refund.created),
        refund,
      ]
    );

    await this.refreshOriginalPaymentRefundState(
      environment,
      stripePaymentIntentId,
      stripeChargeId
    );
  }

  async updatePaymentHistoryFromRefundedCharge(
    environment: StripeEnvironment,
    charge: StripeCharge
  ): Promise<void> {
    const stripePaymentIntentId = getStripeObjectId(charge.payment_intent);
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

  private async upsertCheckoutPaymentHistory(
    environment: StripeEnvironment,
    checkoutSession: StripeCheckoutSession,
    statusOverride?: PaymentHistoryStatus
  ): Promise<void> {
    const subject = getBillingSubjectFromMetadata(checkoutSession.metadata);
    const stripePaymentIntentId = getStripeObjectId(checkoutSession.payment_intent);
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
           AND type <> 'refund'
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
        getStripeObjectId(checkoutSession.customer),
        checkoutSession.customer_details?.email ?? null,
        checkoutSession.id,
        stripePaymentIntentId,
        getStripeObjectId(checkoutSession.subscription),
        checkoutSession.amount_total ?? null,
        checkoutSession.currency ?? null,
        null,
        status === 'succeeded' ? new Date() : null,
        fromStripeTimestamp(checkoutSession.created),
        checkoutSession,
      ]
    );

    if (status === 'succeeded') {
      await this.refreshOriginalPaymentRefundState(environment, stripePaymentIntentId, null);
    }
  }

  private async upsertPaymentIntentHistory(
    environment: StripeEnvironment,
    paymentIntent: StripePaymentIntent,
    status: 'succeeded' | 'failed'
  ): Promise<void> {
    const subject = getBillingSubjectFromMetadata(paymentIntent.metadata);

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
           AND type <> 'refund'
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
        getStripeObjectId(paymentIntent.customer),
        paymentIntent.receipt_email ?? null,
        paymentIntent.id,
        getStripeObjectId(paymentIntent.latest_charge),
        status === 'succeeded' ? paymentIntent.amount_received : paymentIntent.amount,
        paymentIntent.currency,
        paymentIntent.description ?? null,
        status === 'succeeded' ? fromStripeTimestamp(paymentIntent.created) : null,
        status === 'failed' ? fromStripeTimestamp(paymentIntent.created) : null,
        fromStripeTimestamp(paymentIntent.created),
        paymentIntent,
      ]
    );

    if (status === 'succeeded') {
      await this.refreshOriginalPaymentRefundState(
        environment,
        paymentIntent.id,
        getStripeObjectId(paymentIntent.latest_charge)
      );
    }
  }

  private async refreshOriginalPaymentRefundState(
    environment: StripeEnvironment,
    stripePaymentIntentId: string | null,
    stripeChargeId: string | null
  ): Promise<void> {
    if (!stripePaymentIntentId && !stripeChargeId) {
      return;
    }

    await this.getPool().query(
      `WITH refund_totals AS (
         SELECT
           COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::BIGINT AS amount_refunded,
           MAX(refunded_at) FILTER (WHERE status = 'refunded') AS refunded_at
         FROM payments.payment_history
         WHERE environment = $1
           AND type = 'refund'
           AND (
             ($2::TEXT IS NOT NULL AND stripe_payment_intent_id = $2)
             OR ($3::TEXT IS NOT NULL AND stripe_charge_id = $3)
           )
       ),
       original_context AS (
         SELECT
           subject_type,
           subject_id,
           stripe_customer_id,
           customer_email_snapshot,
           stripe_invoice_id,
           stripe_subscription_id,
           stripe_product_id,
           stripe_price_id
         FROM payments.payment_history
         WHERE environment = $1
           AND type <> 'refund'
           AND (
             ($2::TEXT IS NOT NULL AND stripe_payment_intent_id = $2)
             OR ($3::TEXT IS NOT NULL AND stripe_charge_id = $3)
           )
         ORDER BY created_at DESC
         LIMIT 1
       ),
       updated_original AS (
         UPDATE payments.payment_history original
         SET amount_refunded = refund_totals.amount_refunded,
             status = CASE
               WHEN refund_totals.amount_refunded > 0
                 AND original.amount IS NOT NULL
                 AND refund_totals.amount_refunded >= original.amount
                 THEN 'refunded'
               WHEN refund_totals.amount_refunded > 0
                 THEN 'partially_refunded'
               WHEN original.status IN ('refunded', 'partially_refunded')
                 THEN CASE WHEN original.failed_at IS NOT NULL THEN 'failed' ELSE 'succeeded' END
               ELSE original.status
             END,
             refunded_at = CASE
               WHEN refund_totals.amount_refunded > 0 THEN refund_totals.refunded_at
               ELSE NULL
             END,
             updated_at = NOW()
         FROM refund_totals
         WHERE original.environment = $1
           AND original.type <> 'refund'
           AND (
             ($2::TEXT IS NOT NULL AND original.stripe_payment_intent_id = $2)
             OR ($3::TEXT IS NOT NULL AND original.stripe_charge_id = $3)
           )
         RETURNING original.id
       )
       UPDATE payments.payment_history refund
       SET subject_type = COALESCE(refund.subject_type, original_context.subject_type),
           subject_id = COALESCE(refund.subject_id, original_context.subject_id),
           stripe_customer_id = COALESCE(refund.stripe_customer_id, original_context.stripe_customer_id),
           customer_email_snapshot = COALESCE(refund.customer_email_snapshot, original_context.customer_email_snapshot),
           stripe_invoice_id = COALESCE(refund.stripe_invoice_id, original_context.stripe_invoice_id),
           stripe_subscription_id = COALESCE(refund.stripe_subscription_id, original_context.stripe_subscription_id),
           stripe_product_id = COALESCE(refund.stripe_product_id, original_context.stripe_product_id),
           stripe_price_id = COALESCE(refund.stripe_price_id, original_context.stripe_price_id),
           updated_at = NOW()
       FROM original_context
       WHERE refund.environment = $1
         AND refund.type = 'refund'
         AND (
           ($2::TEXT IS NOT NULL AND refund.stripe_payment_intent_id = $2)
           OR ($3::TEXT IS NOT NULL AND refund.stripe_charge_id = $3)
         )
         AND (
           (refund.subject_type IS NULL AND original_context.subject_type IS NOT NULL)
           OR (refund.subject_id IS NULL AND original_context.subject_id IS NOT NULL)
           OR (refund.stripe_customer_id IS NULL AND original_context.stripe_customer_id IS NOT NULL)
           OR (refund.customer_email_snapshot IS NULL AND original_context.customer_email_snapshot IS NOT NULL)
           OR (refund.stripe_invoice_id IS NULL AND original_context.stripe_invoice_id IS NOT NULL)
           OR (refund.stripe_subscription_id IS NULL AND original_context.stripe_subscription_id IS NOT NULL)
           OR (refund.stripe_product_id IS NULL AND original_context.stripe_product_id IS NOT NULL)
           OR (refund.stripe_price_id IS NULL AND original_context.stripe_price_id IS NOT NULL)
         )`,
      [environment, stripePaymentIntentId, stripeChargeId]
    );
  }

  private async upsertOriginalPaymentHistoryForRefund(
    environment: StripeEnvironment,
    stripeContext: RefundStripeContext
  ): Promise<void> {
    if (stripeContext.invoice) {
      await this.upsertInvoicePaymentHistory(environment, stripeContext.invoice, 'succeeded');
      return;
    }

    if (stripeContext.paymentIntent?.status === 'succeeded') {
      await this.processPaymentIntentHistory(environment, stripeContext.paymentIntent, 'succeeded');
    }
  }

  private async buildRefundContextFromStripeContext(
    environment: StripeEnvironment,
    stripeContext: RefundStripeContext
  ): Promise<PaymentHistoryContext | null> {
    const { paymentIntent, charge, invoice } = stripeContext;
    const stripeCustomerId =
      getStripeObjectId(invoice?.customer) ??
      getStripeObjectId(paymentIntent?.customer) ??
      getStripeObjectId(charge?.customer);
    const subject =
      getBillingSubjectFromMetadata(paymentIntent?.metadata) ??
      getBillingSubjectFromMetadata(charge?.metadata) ??
      (invoice ? await this.resolveInvoiceSubject(environment, invoice, stripeCustomerId) : null) ??
      (stripeCustomerId
        ? await this.findSubjectForStripeCustomer(environment, stripeCustomerId)
        : null);
    const firstLine = invoice?.lines?.data?.[0] ?? null;
    const context: PaymentHistoryContext = {
      subjectType: subject?.type ?? null,
      subjectId: subject?.id ?? null,
      stripeCustomerId,
      customerEmailSnapshot:
        invoice?.customer_email ??
        paymentIntent?.receipt_email ??
        charge?.billing_details?.email ??
        null,
      stripeInvoiceId: invoice?.id ?? null,
      stripeSubscriptionId: invoice ? this.getInvoiceSubscriptionId(invoice) : null,
      stripeProductId: invoice ? this.getInvoiceLineItemProductId(firstLine) : null,
      stripePriceId: invoice ? this.getInvoiceLineItemPriceId(firstLine) : null,
      description:
        invoice?.description ?? paymentIntent?.description ?? charge?.description ?? null,
    };

    if (Object.values(context).some((value) => value !== null)) {
      return context;
    }

    return null;
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

  private async resolveInvoiceSubject(
    environment: StripeEnvironment,
    invoice: StripeInvoice,
    stripeCustomerId: string | null
  ): Promise<BillingSubject | null> {
    const parentMetadata = invoice.parent?.subscription_details?.metadata;

    return (
      getBillingSubjectFromMetadata(parentMetadata) ??
      getBillingSubjectFromMetadata(invoice.metadata) ??
      (stripeCustomerId
        ? await this.findSubjectForStripeCustomer(environment, stripeCustomerId)
        : null)
    );
  }

  private getInvoiceSubscriptionId(invoice: StripeInvoice): string | null {
    const parentSubscription = getStripeObjectId(
      invoice.parent?.subscription_details?.subscription
    );
    if (parentSubscription) {
      return parentSubscription;
    }

    for (const line of invoice.lines?.data ?? []) {
      const lineSubscription =
        getStripeObjectId(line.subscription) ??
        getStripeObjectId(line.parent?.subscription_item_details?.subscription) ??
        getStripeObjectId(line.parent?.invoice_item_details?.subscription);
      if (lineSubscription) {
        return lineSubscription;
      }
    }

    return null;
  }

  private getInvoicePaymentIntentId(invoice: StripeInvoice): string | null {
    for (const payment of invoice.payments?.data ?? []) {
      const paymentIntentId = getStripeObjectId(payment.payment.payment_intent);
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
    return getStripeObjectId(line?.pricing?.price_details?.price);
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

    return fromStripeTimestamp(Math.max(...refundTimestamps));
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
      paidAt: toISOStringOrNull(row.paidAt),
      failedAt: toISOStringOrNull(row.failedAt),
      refundedAt: toISOStringOrNull(row.refundedAt),
      stripeCreatedAt: toISOStringOrNull(row.stripeCreatedAt),
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }
}
