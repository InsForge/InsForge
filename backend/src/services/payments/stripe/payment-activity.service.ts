import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { STRIPE_CHECKOUT_MODE_METADATA_KEY } from '@/services/payments/stripe/constants.js';
import {
  fromStripeTimestamp,
  getBillingSubjectFromMetadata,
  getStripeObjectId,
  normalizePaymentActivityRow,
} from '@/services/payments/helpers.js';
import type {
  PaymentActivityRow,
  StripeCharge,
  StripeCheckoutSession,
  StripeEnvironment,
  StripeInvoice,
  StripePaymentIntent,
  StripeRefund,
} from '@/types/payments.js';
import type {
  BillingSubject,
  ListPaymentActivityRequest,
  ListPaymentActivityResponse,
} from '@insforge/shared-schemas';

type PaymentActivityStatus = 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded';

interface PaymentActivityContext {
  subjectType: string | null;
  subjectId: string | null;
  customerId: string | null;
  customerEmailSnapshot: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
  productId: string | null;
  priceId: string | null;
  description: string | null;
}

interface RefundStripeContext {
  paymentIntent: StripePaymentIntent | null;
  charge: StripeCharge | null;
  invoice: StripeInvoice | null;
}

type RefundStripeContextLoader = () => Promise<RefundStripeContext>;

export class StripePaymentActivityService {
  private static instance: StripePaymentActivityService;
  private pool: Pool | null = null;

  static getInstance(): StripePaymentActivityService {
    if (!StripePaymentActivityService.instance) {
      StripePaymentActivityService.instance = new StripePaymentActivityService();
    }

    return StripePaymentActivityService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async listPaymentActivity(
    input: ListPaymentActivityRequest
  ): Promise<ListPaymentActivityResponse> {
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
         'stripe'::TEXT AS provider,
         type,
         status,
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         customer_id AS "providerCustomerId",
         customer_email_snapshot AS "customerEmailSnapshot",
         CASE
           WHEN type = 'refund' THEN refund_id
           WHEN payment_intent_id IS NOT NULL THEN payment_intent_id
           WHEN charge_id IS NOT NULL THEN charge_id
           WHEN invoice_id IS NOT NULL THEN invoice_id
           ELSE checkout_session_id
         END AS "providerReferenceId",
         CASE
           WHEN type = 'refund' AND refund_id IS NOT NULL THEN 'refund'
           WHEN payment_intent_id IS NOT NULL THEN 'payment_intent'
           WHEN charge_id IS NOT NULL THEN 'charge'
           WHEN invoice_id IS NOT NULL THEN 'invoice'
           WHEN checkout_session_id IS NOT NULL THEN 'checkout_session'
           ELSE NULL
         END AS "providerReferenceType",
         amount,
         amount_refunded AS "amountRefunded",
         currency,
         description,
         paid_at AS "paidAt",
         failed_at AS "failedAt",
         refunded_at AS "refundedAt",
         provider_created_at AS "providerCreatedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM payments.stripe_payment_activity
       WHERE ${filters.join(' AND ')}
       ORDER BY COALESCE(provider_created_at, created_at) DESC
       LIMIT $${params.length}`,
      params
    );

    return {
      paymentActivity: (result.rows as PaymentActivityRow[]).map((row) =>
        normalizePaymentActivityRow(row)
      ),
    };
  }

  async processCheckoutSessionCompleted(
    environment: StripeEnvironment,
    checkoutSession: StripeCheckoutSession,
    statusOverride?: PaymentActivityStatus,
    paidAtOverride?: Date | null
  ): Promise<boolean> {
    if (checkoutSession.mode !== 'payment') {
      return false;
    }

    await this.upsertCheckoutPaymentActivity(
      environment,
      checkoutSession,
      statusOverride,
      paidAtOverride
    );
    return true;
  }

  async upsertInvoicePaymentActivity(
    environment: StripeEnvironment,
    invoice: StripeInvoice,
    status: 'succeeded' | 'failed'
  ): Promise<void> {
    const customerId = getStripeObjectId(invoice.customer);
    const subscriptionId = this.getInvoiceSubscriptionId(invoice);
    const subject = await this.resolveInvoiceSubject(environment, invoice, customerId);
    const paymentIntentId = this.getInvoicePaymentIntentId(invoice);
    const firstLine = invoice.lines?.data?.[0] ?? null;
    const productId = this.getInvoiceLineItemProductId(firstLine);
    const priceId = this.getInvoiceLineItemPriceId(firstLine);
    const paidAt =
      status === 'succeeded'
        ? (fromStripeTimestamp(invoice.status_transitions?.paid_at) ??
          fromStripeTimestamp(invoice.created))
        : null;
    const failedAt = status === 'failed' ? fromStripeTimestamp(invoice.created) : null;

    await this.getPool().query(
      `INSERT INTO payments.stripe_payment_activity AS payment_activity (
         environment,
         type,
         status,
         subject_type,
         subject_id,
         customer_id,
         customer_email_snapshot,
         payment_intent_id,
         invoice_id,
         subscription_id,
         product_id,
         price_id,
         amount,
         currency,
         description,
         paid_at,
         failed_at,
         provider_created_at,
         raw
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (environment, invoice_id)
         WHERE invoice_id IS NOT NULL
           AND type <> 'refund'
       DO UPDATE SET
         type = EXCLUDED.type,
         status = EXCLUDED.status,
         subject_type = COALESCE(EXCLUDED.subject_type, payment_activity.subject_type),
         subject_id = COALESCE(EXCLUDED.subject_id, payment_activity.subject_id),
         customer_id = COALESCE(EXCLUDED.customer_id, payment_activity.customer_id),
         customer_email_snapshot = COALESCE(EXCLUDED.customer_email_snapshot, payment_activity.customer_email_snapshot),
         payment_intent_id = COALESCE(EXCLUDED.payment_intent_id, payment_activity.payment_intent_id),
         subscription_id = COALESCE(EXCLUDED.subscription_id, payment_activity.subscription_id),
         product_id = COALESCE(EXCLUDED.product_id, payment_activity.product_id),
         price_id = COALESCE(EXCLUDED.price_id, payment_activity.price_id),
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         description = EXCLUDED.description,
         paid_at = EXCLUDED.paid_at,
         failed_at = EXCLUDED.failed_at,
         provider_created_at = EXCLUDED.provider_created_at,
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        environment,
        subscriptionId ? 'subscription_invoice' : 'one_time_payment',
        status,
        subject?.type ?? null,
        subject?.id ?? null,
        customerId,
        invoice.customer_email ?? null,
        paymentIntentId,
        invoice.id,
        subscriptionId,
        productId,
        priceId,
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
      await this.refreshOriginalPaymentRefundState(environment, paymentIntentId, null);
    }
  }

  async processPaymentIntentActivity(
    environment: StripeEnvironment,
    paymentIntent: StripePaymentIntent,
    status: 'succeeded' | 'failed'
  ): Promise<boolean> {
    if (paymentIntent.metadata?.[STRIPE_CHECKOUT_MODE_METADATA_KEY] !== 'payment') {
      return false;
    }

    await this.upsertPaymentIntentActivity(environment, paymentIntent, status);
    return true;
  }

  async upsertRefundPaymentActivity(
    environment: StripeEnvironment,
    refund: StripeRefund,
    loadStripeContext?: RefundStripeContextLoader
  ): Promise<void> {
    const paymentIntentId = getStripeObjectId(refund.payment_intent);
    const chargeId = getStripeObjectId(refund.charge);
    let context = await this.findPaymentActivityContextForRefund(
      environment,
      paymentIntentId,
      chargeId
    );

    if (!context && loadStripeContext) {
      const stripeContext = await loadStripeContext();
      await this.upsertOriginalPaymentActivityForRefund(environment, stripeContext);
      context =
        (await this.findPaymentActivityContextForRefund(environment, paymentIntentId, chargeId)) ??
        (await this.buildRefundContextFromStripeContext(environment, stripeContext));
    }

    const mappedStatus = this.mapRefundStatus(refund.status);

    await this.getPool().query(
      `INSERT INTO payments.stripe_payment_activity AS payment_activity (
         environment,
         type,
         status,
         subject_type,
         subject_id,
         customer_id,
         customer_email_snapshot,
         payment_intent_id,
         invoice_id,
         charge_id,
         refund_id,
         subscription_id,
         product_id,
         price_id,
         amount,
         currency,
         description,
         refunded_at,
         provider_created_at,
         raw
       )
       VALUES ($1, 'refund', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (environment, refund_id)
         WHERE refund_id IS NOT NULL
       DO UPDATE SET
         status = EXCLUDED.status,
         subject_type = COALESCE(EXCLUDED.subject_type, payment_activity.subject_type),
         subject_id = COALESCE(EXCLUDED.subject_id, payment_activity.subject_id),
         customer_id = COALESCE(EXCLUDED.customer_id, payment_activity.customer_id),
         customer_email_snapshot = COALESCE(EXCLUDED.customer_email_snapshot, payment_activity.customer_email_snapshot),
         payment_intent_id = COALESCE(EXCLUDED.payment_intent_id, payment_activity.payment_intent_id),
         invoice_id = COALESCE(EXCLUDED.invoice_id, payment_activity.invoice_id),
         charge_id = COALESCE(EXCLUDED.charge_id, payment_activity.charge_id),
         subscription_id = COALESCE(EXCLUDED.subscription_id, payment_activity.subscription_id),
         product_id = COALESCE(EXCLUDED.product_id, payment_activity.product_id),
         price_id = COALESCE(EXCLUDED.price_id, payment_activity.price_id),
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         description = EXCLUDED.description,
         refunded_at = EXCLUDED.refunded_at,
         provider_created_at = EXCLUDED.provider_created_at,
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        environment,
        mappedStatus,
        context?.subjectType ?? null,
        context?.subjectId ?? null,
        context?.customerId ?? null,
        context?.customerEmailSnapshot ?? null,
        paymentIntentId,
        context?.invoiceId ?? null,
        chargeId,
        refund.id,
        context?.subscriptionId ?? null,
        context?.productId ?? null,
        context?.priceId ?? null,
        refund.amount,
        refund.currency,
        refund.description ?? refund.reason ?? context?.description ?? null,
        mappedStatus === 'refunded' ? fromStripeTimestamp(refund.created) : null,
        fromStripeTimestamp(refund.created),
        refund,
      ]
    );

    await this.refreshOriginalPaymentRefundState(environment, paymentIntentId, chargeId);
  }

  async updatePaymentActivityFromRefundedCharge(
    environment: StripeEnvironment,
    charge: StripeCharge
  ): Promise<void> {
    const paymentIntentId = getStripeObjectId(charge.payment_intent);
    const refundedAt = this.getLatestRefundCreatedAt(charge) ?? new Date();

    await this.getPool().query(
      `UPDATE payments.stripe_payment_activity
       SET amount_refunded = $4,
           status = CASE WHEN $5 THEN 'refunded' ELSE 'partially_refunded' END,
           refunded_at = $6,
           updated_at = NOW()
       WHERE environment = $1
         AND type <> 'refund'
         AND (
           ($2::TEXT IS NOT NULL AND payment_intent_id = $2)
           OR ($3::TEXT IS NOT NULL AND charge_id = $3)
         )`,
      [environment, paymentIntentId, charge.id, charge.amount_refunded, charge.refunded, refundedAt]
    );
  }

  private async upsertCheckoutPaymentActivity(
    environment: StripeEnvironment,
    checkoutSession: StripeCheckoutSession,
    statusOverride?: PaymentActivityStatus,
    paidAtOverride?: Date | null
  ): Promise<void> {
    const subject = getBillingSubjectFromMetadata(checkoutSession.metadata);
    const paymentIntentId = getStripeObjectId(checkoutSession.payment_intent);
    const status =
      statusOverride ?? (checkoutSession.payment_status === 'paid' ? 'succeeded' : 'pending');
    const paidAt =
      status === 'succeeded'
        ? (paidAtOverride ?? fromStripeTimestamp(checkoutSession.created))
        : null;
    const conflictTarget = paymentIntentId
      ? `(environment, payment_intent_id)
         WHERE payment_intent_id IS NOT NULL
           AND type <> 'refund'`
      : `(environment, checkout_session_id)
         WHERE checkout_session_id IS NOT NULL
           AND type <> 'refund'`;

    await this.getPool().query(
      `WITH updated AS (
         UPDATE payments.stripe_payment_activity
         SET status = $2,
             subject_type = $3,
             subject_id = $4,
             customer_id = $5,
             customer_email_snapshot = $6,
             checkout_session_id = $7,
             payment_intent_id = COALESCE($8, payment_intent_id),
             subscription_id = $9,
             amount = $10,
             currency = $11,
             description = $12,
             paid_at = $13,
             provider_created_at = $14,
             raw = $15,
             updated_at = NOW()
         WHERE environment = $1
           AND type <> 'refund'
           AND (
             checkout_session_id = $7
             OR ($8::TEXT IS NOT NULL AND payment_intent_id = $8)
           )
         RETURNING id
       )
       INSERT INTO payments.stripe_payment_activity (
         environment,
         type,
         status,
         subject_type,
         subject_id,
         customer_id,
         customer_email_snapshot,
         checkout_session_id,
         payment_intent_id,
         subscription_id,
         amount,
         currency,
         description,
         paid_at,
         provider_created_at,
         raw
       )
       SELECT $1, 'one_time_payment', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
       WHERE NOT EXISTS (SELECT 1 FROM updated)
       ON CONFLICT ${conflictTarget}
       DO UPDATE SET
         status = EXCLUDED.status,
         subject_type = EXCLUDED.subject_type,
         subject_id = EXCLUDED.subject_id,
         customer_id = EXCLUDED.customer_id,
         customer_email_snapshot = EXCLUDED.customer_email_snapshot,
         checkout_session_id = EXCLUDED.checkout_session_id,
         payment_intent_id = COALESCE(EXCLUDED.payment_intent_id, payment_activity.payment_intent_id),
         subscription_id = EXCLUDED.subscription_id,
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         description = EXCLUDED.description,
         paid_at = EXCLUDED.paid_at,
         provider_created_at = EXCLUDED.provider_created_at,
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
        paymentIntentId,
        getStripeObjectId(checkoutSession.subscription),
        checkoutSession.amount_total ?? null,
        checkoutSession.currency ?? null,
        null,
        paidAt,
        fromStripeTimestamp(checkoutSession.created),
        checkoutSession,
      ]
    );

    if (status === 'succeeded') {
      await this.refreshOriginalPaymentRefundState(environment, paymentIntentId, null);
    }
  }

  private async upsertPaymentIntentActivity(
    environment: StripeEnvironment,
    paymentIntent: StripePaymentIntent,
    status: 'succeeded' | 'failed'
  ): Promise<void> {
    const subject = getBillingSubjectFromMetadata(paymentIntent.metadata);

    await this.getPool().query(
      `INSERT INTO payments.stripe_payment_activity (
         environment,
         type,
         status,
         subject_type,
         subject_id,
         customer_id,
         customer_email_snapshot,
         payment_intent_id,
         charge_id,
         amount,
         currency,
         description,
         paid_at,
         failed_at,
         provider_created_at,
         raw
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (environment, payment_intent_id)
         WHERE payment_intent_id IS NOT NULL
           AND type <> 'refund'
       DO UPDATE SET
         type = EXCLUDED.type,
         status = EXCLUDED.status,
         subject_type = EXCLUDED.subject_type,
         subject_id = EXCLUDED.subject_id,
         customer_id = EXCLUDED.customer_id,
         customer_email_snapshot = EXCLUDED.customer_email_snapshot,
         payment_intent_id = EXCLUDED.payment_intent_id,
         charge_id = EXCLUDED.charge_id,
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         description = EXCLUDED.description,
         paid_at = EXCLUDED.paid_at,
         failed_at = EXCLUDED.failed_at,
         provider_created_at = EXCLUDED.provider_created_at,
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
    paymentIntentId: string | null,
    chargeId: string | null
  ): Promise<void> {
    if (!paymentIntentId && !chargeId) {
      return;
    }

    await this.getPool().query(
      `WITH refund_totals AS (
         SELECT
           COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::BIGINT AS amount_refunded,
           MAX(refunded_at) FILTER (WHERE status = 'refunded') AS refunded_at
         FROM payments.stripe_payment_activity
         WHERE environment = $1
           AND type = 'refund'
           AND (
             ($2::TEXT IS NOT NULL AND payment_intent_id = $2)
             OR ($3::TEXT IS NOT NULL AND charge_id = $3)
           )
       ),
       original_context AS (
         SELECT
           subject_type,
           subject_id,
           customer_id,
           customer_email_snapshot,
           invoice_id,
           subscription_id,
           product_id,
           price_id
         FROM payments.stripe_payment_activity
         WHERE environment = $1
           AND type <> 'refund'
           AND (
             ($2::TEXT IS NOT NULL AND payment_intent_id = $2)
             OR ($3::TEXT IS NOT NULL AND charge_id = $3)
           )
         ORDER BY created_at DESC
         LIMIT 1
       ),
       updated_original AS (
         UPDATE payments.stripe_payment_activity original
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
             ($2::TEXT IS NOT NULL AND original.payment_intent_id = $2)
             OR ($3::TEXT IS NOT NULL AND original.charge_id = $3)
           )
         RETURNING original.id
       )
       UPDATE payments.stripe_payment_activity refund
       SET subject_type = COALESCE(refund.subject_type, original_context.subject_type),
           subject_id = COALESCE(refund.subject_id, original_context.subject_id),
           customer_id = COALESCE(refund.customer_id, original_context.customer_id),
           customer_email_snapshot = COALESCE(refund.customer_email_snapshot, original_context.customer_email_snapshot),
           invoice_id = COALESCE(refund.invoice_id, original_context.invoice_id),
           subscription_id = COALESCE(refund.subscription_id, original_context.subscription_id),
           product_id = COALESCE(refund.product_id, original_context.product_id),
           price_id = COALESCE(refund.price_id, original_context.price_id),
           updated_at = NOW()
       FROM original_context
       WHERE refund.environment = $1
         AND refund.type = 'refund'
         AND (
           ($2::TEXT IS NOT NULL AND refund.payment_intent_id = $2)
           OR ($3::TEXT IS NOT NULL AND refund.charge_id = $3)
         )
         AND (
           (refund.subject_type IS NULL AND original_context.subject_type IS NOT NULL)
           OR (refund.subject_id IS NULL AND original_context.subject_id IS NOT NULL)
           OR (refund.customer_id IS NULL AND original_context.customer_id IS NOT NULL)
           OR (refund.customer_email_snapshot IS NULL AND original_context.customer_email_snapshot IS NOT NULL)
           OR (refund.invoice_id IS NULL AND original_context.invoice_id IS NOT NULL)
           OR (refund.subscription_id IS NULL AND original_context.subscription_id IS NOT NULL)
           OR (refund.product_id IS NULL AND original_context.product_id IS NOT NULL)
           OR (refund.price_id IS NULL AND original_context.price_id IS NOT NULL)
         )`,
      [environment, paymentIntentId, chargeId]
    );
  }

  private async upsertOriginalPaymentActivityForRefund(
    environment: StripeEnvironment,
    stripeContext: RefundStripeContext
  ): Promise<void> {
    if (stripeContext.invoice) {
      await this.upsertInvoicePaymentActivity(environment, stripeContext.invoice, 'succeeded');
      return;
    }

    if (stripeContext.paymentIntent?.status === 'succeeded') {
      await this.processPaymentIntentActivity(
        environment,
        stripeContext.paymentIntent,
        'succeeded'
      );
    }
  }

  private async buildRefundContextFromStripeContext(
    environment: StripeEnvironment,
    stripeContext: RefundStripeContext
  ): Promise<PaymentActivityContext | null> {
    const { paymentIntent, charge, invoice } = stripeContext;
    const customerId =
      getStripeObjectId(invoice?.customer) ??
      getStripeObjectId(paymentIntent?.customer) ??
      getStripeObjectId(charge?.customer);
    const subject =
      getBillingSubjectFromMetadata(paymentIntent?.metadata) ??
      getBillingSubjectFromMetadata(charge?.metadata) ??
      (invoice ? await this.resolveInvoiceSubject(environment, invoice, customerId) : null) ??
      (customerId ? await this.findSubjectForStripeCustomer(environment, customerId) : null);
    const firstLine = invoice?.lines?.data?.[0] ?? null;
    const context: PaymentActivityContext = {
      subjectType: subject?.type ?? null,
      subjectId: subject?.id ?? null,
      customerId: customerId,
      customerEmailSnapshot:
        invoice?.customer_email ??
        paymentIntent?.receipt_email ??
        charge?.billing_details?.email ??
        null,
      invoiceId: invoice?.id ?? null,
      subscriptionId: invoice ? this.getInvoiceSubscriptionId(invoice) : null,
      productId: invoice ? this.getInvoiceLineItemProductId(firstLine) : null,
      priceId: invoice ? this.getInvoiceLineItemPriceId(firstLine) : null,
      description:
        invoice?.description ?? paymentIntent?.description ?? charge?.description ?? null,
    };

    if (Object.values(context).some((value) => value !== null)) {
      return context;
    }

    return null;
  }

  private async findPaymentActivityContextForRefund(
    environment: StripeEnvironment,
    paymentIntentId: string | null,
    chargeId: string | null
  ): Promise<PaymentActivityContext | null> {
    if (!paymentIntentId && !chargeId) {
      return null;
    }

    const result = await this.getPool().query(
      `SELECT
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         customer_id AS "customerId",
         customer_email_snapshot AS "customerEmailSnapshot",
         invoice_id AS "invoiceId",
         subscription_id AS "subscriptionId",
         product_id AS "productId",
         price_id AS "priceId",
         description
       FROM payments.stripe_payment_activity
       WHERE environment = $1
         AND type <> 'refund'
         AND (
           ($2::TEXT IS NOT NULL AND payment_intent_id = $2)
           OR ($3::TEXT IS NOT NULL AND charge_id = $3)
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [environment, paymentIntentId, chargeId]
    );

    return (result.rows[0] as PaymentActivityContext | undefined) ?? null;
  }

  private async findStripeCustomerMappingByCustomerId(
    environment: StripeEnvironment,
    customerId: string
  ): Promise<{ subjectType: string; subjectId: string } | null> {
    const result = await this.getPool().query(
      `SELECT
         subject_type AS "subjectType",
         subject_id AS "subjectId"
       FROM payments.customer_mappings
       WHERE provider = 'stripe'
         AND environment = $1
         AND provider_customer_id = $2`,
      [environment, customerId]
    );

    return (result.rows[0] as { subjectType: string; subjectId: string } | undefined) ?? null;
  }

  private async findSubjectForStripeCustomer(
    environment: StripeEnvironment,
    customerId: string
  ): Promise<BillingSubject | null> {
    const mapping = await this.findStripeCustomerMappingByCustomerId(environment, customerId);
    if (!mapping) {
      return null;
    }

    return { type: mapping.subjectType, id: mapping.subjectId };
  }

  private async resolveInvoiceSubject(
    environment: StripeEnvironment,
    invoice: StripeInvoice,
    customerId: string | null
  ): Promise<BillingSubject | null> {
    const parentMetadata = invoice.parent?.subscription_details?.metadata;

    return (
      getBillingSubjectFromMetadata(parentMetadata) ??
      getBillingSubjectFromMetadata(invoice.metadata) ??
      (customerId ? await this.findSubjectForStripeCustomer(environment, customerId) : null)
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

  private mapRefundStatus(status: string | null): PaymentActivityStatus {
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
}
