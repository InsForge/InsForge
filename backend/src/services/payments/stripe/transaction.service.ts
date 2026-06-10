import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { STRIPE_CHECKOUT_MODE_METADATA_KEY } from '@/services/payments/stripe/constants.js';
import {
  fromStripeTimestamp,
  getBillingSubjectFromProviderAttributes,
  getStripeObjectId,
} from '@/services/payments/helpers.js';
import type {
  StripeCharge,
  StripeCheckoutSession,
  StripeEnvironment,
  StripeInvoice,
  StripePaymentIntent,
  StripeRefund,
} from '@/types/payments.js';
import type { BillingSubject } from '@insforge/shared-schemas';

type StripeTransactionStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

type StripeTransactionType =
  | 'one_time_payment'
  | 'subscription_invoice'
  | 'refund'
  | 'failed_payment';

interface TransactionObjectRef {
  type: string;
  id: string | null;
}

interface TransactionContext {
  subjectType: string | null;
  subjectId: string | null;
  providerCustomerId: string | null;
  customerEmailSnapshot: string | null;
  relatedObjectIds: Record<string, string>;
  description: string | null;
}

interface UpsertStripeTransactionInput {
  environment: StripeEnvironment;
  type: StripeTransactionType;
  status: StripeTransactionStatus;
  subject: BillingSubject | null;
  providerCustomerId: string | null;
  customerEmailSnapshot: string | null;
  providerObjectType: string;
  providerObjectId: string;
  providerParentObjectType?: string | null;
  providerParentObjectId?: string | null;
  relatedObjectIds: Record<string, string | null | undefined>;
  amount: number | null;
  amountRefunded?: number | null;
  currency: string | null;
  description: string | null;
  paidAt: Date | null;
  failedAt: Date | null;
  refundedAt: Date | null;
  providerCreatedAt: Date | null;
  raw: unknown;
  matchObjectRefs?: TransactionObjectRef[];
}

interface RefundStripeContext {
  paymentIntent: StripePaymentIntent | null;
  charge: StripeCharge | null;
  invoice: StripeInvoice | null;
}

type RefundStripeContextLoader = () => Promise<RefundStripeContext>;

export class StripeTransactionService {
  private static instance: StripeTransactionService;
  private pool: Pool | null = null;

  static getInstance(): StripeTransactionService {
    if (!StripeTransactionService.instance) {
      StripeTransactionService.instance = new StripeTransactionService();
    }

    return StripeTransactionService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async processCheckoutSessionCompleted(
    environment: StripeEnvironment,
    checkoutSession: StripeCheckoutSession,
    statusOverride?: StripeTransactionStatus,
    eventAtOverride?: Date | null
  ): Promise<boolean> {
    if (checkoutSession.mode !== 'payment') {
      return false;
    }

    await this.upsertCheckoutTransaction(
      environment,
      checkoutSession,
      statusOverride,
      eventAtOverride
    );
    return true;
  }

  async upsertInvoiceTransaction(
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
    const primaryObject = paymentIntentId
      ? { type: 'payment_intent', id: paymentIntentId }
      : { type: 'invoice', id: invoice.id };
    const paidAt =
      status === 'succeeded'
        ? (fromStripeTimestamp(invoice.status_transitions?.paid_at) ??
          fromStripeTimestamp(invoice.created))
        : null;
    const failedAt = status === 'failed' ? fromStripeTimestamp(invoice.created) : null;

    await this.upsertTransaction({
      environment,
      type: subscriptionId ? 'subscription_invoice' : 'one_time_payment',
      status,
      subject,
      providerCustomerId: customerId,
      customerEmailSnapshot: invoice.customer_email ?? null,
      providerObjectType: primaryObject.type,
      providerObjectId: primaryObject.id,
      relatedObjectIds: {
        payment_intent: paymentIntentId,
        invoice: invoice.id,
        subscription: subscriptionId,
        product: productId,
        price: priceId,
      },
      amount: status === 'succeeded' ? invoice.amount_paid : invoice.amount_due,
      currency: invoice.currency,
      description: invoice.description ?? invoice.number ?? null,
      paidAt,
      failedAt,
      refundedAt: null,
      providerCreatedAt: fromStripeTimestamp(invoice.created),
      raw: invoice,
      matchObjectRefs: [
        { type: 'invoice', id: invoice.id },
        { type: 'payment_intent', id: paymentIntentId },
      ],
    });

    if (status === 'succeeded') {
      await this.refreshOriginalTransactionRefundState(environment, paymentIntentId, null);
    }
  }

  async processPaymentIntentTransaction(
    environment: StripeEnvironment,
    paymentIntent: StripePaymentIntent,
    status: 'succeeded' | 'failed'
  ): Promise<boolean> {
    if (paymentIntent.metadata?.[STRIPE_CHECKOUT_MODE_METADATA_KEY] !== 'payment') {
      return false;
    }

    await this.upsertPaymentIntentTransaction(environment, paymentIntent, status);
    return true;
  }

  async upsertRefundTransaction(
    environment: StripeEnvironment,
    refund: StripeRefund,
    loadStripeContext?: RefundStripeContextLoader
  ): Promise<void> {
    const paymentIntentId = getStripeObjectId(refund.payment_intent);
    const chargeId = getStripeObjectId(refund.charge);
    let context = await this.findTransactionContextForRefund(
      environment,
      paymentIntentId,
      chargeId
    );

    if (!context && loadStripeContext) {
      const stripeContext = await loadStripeContext();
      await this.upsertOriginalTransactionForRefund(environment, stripeContext);
      context =
        (await this.findTransactionContextForRefund(environment, paymentIntentId, chargeId)) ??
        (await this.buildRefundContextFromStripeContext(environment, stripeContext));
    }

    const mappedStatus = this.mapRefundStatus(refund.status);
    const parentObject =
      paymentIntentId !== null
        ? { type: 'payment_intent', id: paymentIntentId }
        : { type: 'charge', id: chargeId };

    await this.upsertTransaction({
      environment,
      type: 'refund',
      status: mappedStatus,
      subject: this.contextToSubject(context),
      providerCustomerId: context?.providerCustomerId ?? null,
      customerEmailSnapshot: context?.customerEmailSnapshot ?? null,
      providerObjectType: 'refund',
      providerObjectId: refund.id,
      providerParentObjectType: parentObject.id ? parentObject.type : null,
      providerParentObjectId: parentObject.id,
      relatedObjectIds: {
        refund: refund.id,
        payment_intent: paymentIntentId,
        charge: chargeId,
        invoice: context?.relatedObjectIds?.invoice,
        subscription: context?.relatedObjectIds?.subscription,
        product: context?.relatedObjectIds?.product,
        price: context?.relatedObjectIds?.price,
      },
      amount: refund.amount,
      amountRefunded: refund.amount,
      currency: refund.currency,
      description: refund.description ?? refund.reason ?? context?.description ?? null,
      paidAt: null,
      failedAt: mappedStatus === 'failed' ? fromStripeTimestamp(refund.created) : null,
      refundedAt: mappedStatus === 'refunded' ? fromStripeTimestamp(refund.created) : null,
      providerCreatedAt: fromStripeTimestamp(refund.created),
      raw: refund,
      matchObjectRefs: [{ type: 'refund', id: refund.id }],
    });

    await this.refreshOriginalTransactionRefundState(environment, paymentIntentId, chargeId);
  }

  async updateTransactionFromRefundedCharge(
    environment: StripeEnvironment,
    charge: StripeCharge
  ): Promise<void> {
    const paymentIntentId = getStripeObjectId(charge.payment_intent);
    const refundedAt = this.getLatestRefundCreatedAt(charge) ?? new Date();

    await this.getPool().query(
      `UPDATE payments.transactions
       SET amount_refunded = $4,
           status = CASE WHEN $5 THEN 'refunded' ELSE 'partially_refunded' END,
           refunded_at = $6,
           related_object_ids = related_object_ids || $7::JSONB,
           updated_at = NOW()
       WHERE provider = 'stripe'
         AND environment = $1
         AND type <> 'refund'
         AND (
           ($2::TEXT IS NOT NULL AND provider_object_type = 'payment_intent' AND provider_object_id = $2)
           OR ($3::TEXT IS NOT NULL AND provider_object_type = 'charge' AND provider_object_id = $3)
           OR ($2::TEXT IS NOT NULL AND related_object_ids->>'payment_intent' = $2)
           OR ($3::TEXT IS NOT NULL AND related_object_ids->>'charge' = $3)
         )`,
      [
        environment,
        paymentIntentId,
        charge.id,
        charge.amount_refunded,
        charge.refunded,
        refundedAt,
        JSON.stringify(
          this.compactRelatedObjectIds({ payment_intent: paymentIntentId, charge: charge.id })
        ),
      ]
    );
  }

  private async upsertCheckoutTransaction(
    environment: StripeEnvironment,
    checkoutSession: StripeCheckoutSession,
    statusOverride?: StripeTransactionStatus,
    eventAtOverride?: Date | null
  ): Promise<void> {
    const subject = getBillingSubjectFromProviderAttributes(checkoutSession.metadata);
    const paymentIntentId = getStripeObjectId(checkoutSession.payment_intent);
    const subscriptionId = getStripeObjectId(checkoutSession.subscription);
    const customerId = getStripeObjectId(checkoutSession.customer);
    const status =
      statusOverride ?? (checkoutSession.payment_status === 'paid' ? 'succeeded' : 'pending');
    const paidAt =
      status === 'succeeded'
        ? (eventAtOverride ?? fromStripeTimestamp(checkoutSession.created))
        : null;
    const failedAt =
      status === 'failed'
        ? (eventAtOverride ?? fromStripeTimestamp(checkoutSession.created))
        : null;
    const primaryObject = paymentIntentId
      ? { type: 'payment_intent', id: paymentIntentId }
      : { type: 'checkout_session', id: checkoutSession.id };

    await this.upsertTransaction({
      environment,
      type: 'one_time_payment',
      status,
      subject,
      providerCustomerId: customerId,
      customerEmailSnapshot: checkoutSession.customer_details?.email ?? null,
      providerObjectType: primaryObject.type,
      providerObjectId: primaryObject.id,
      relatedObjectIds: {
        checkout_session: checkoutSession.id,
        payment_intent: paymentIntentId,
        subscription: subscriptionId,
      },
      amount: checkoutSession.amount_total ?? null,
      currency: checkoutSession.currency ?? null,
      description: null,
      paidAt,
      failedAt,
      refundedAt: null,
      providerCreatedAt: fromStripeTimestamp(checkoutSession.created),
      raw: checkoutSession,
      matchObjectRefs: [
        { type: 'checkout_session', id: checkoutSession.id },
        { type: 'payment_intent', id: paymentIntentId },
      ],
    });

    if (status === 'succeeded') {
      await this.refreshOriginalTransactionRefundState(environment, paymentIntentId, null);
    }
  }

  private async upsertPaymentIntentTransaction(
    environment: StripeEnvironment,
    paymentIntent: StripePaymentIntent,
    status: 'succeeded' | 'failed'
  ): Promise<void> {
    const subject = getBillingSubjectFromProviderAttributes(paymentIntent.metadata);
    const chargeId = getStripeObjectId(paymentIntent.latest_charge);

    await this.upsertTransaction({
      environment,
      type: status === 'succeeded' ? 'one_time_payment' : 'failed_payment',
      status,
      subject,
      providerCustomerId: getStripeObjectId(paymentIntent.customer),
      customerEmailSnapshot: paymentIntent.receipt_email ?? null,
      providerObjectType: 'payment_intent',
      providerObjectId: paymentIntent.id,
      relatedObjectIds: {
        payment_intent: paymentIntent.id,
        charge: chargeId,
      },
      amount: status === 'succeeded' ? paymentIntent.amount_received : paymentIntent.amount,
      currency: paymentIntent.currency,
      description: paymentIntent.description ?? null,
      paidAt: status === 'succeeded' ? fromStripeTimestamp(paymentIntent.created) : null,
      failedAt: status === 'failed' ? fromStripeTimestamp(paymentIntent.created) : null,
      refundedAt: null,
      providerCreatedAt: fromStripeTimestamp(paymentIntent.created),
      raw: paymentIntent,
      matchObjectRefs: [
        { type: 'payment_intent', id: paymentIntent.id },
        { type: 'charge', id: chargeId },
      ],
    });

    if (status === 'succeeded') {
      await this.refreshOriginalTransactionRefundState(environment, paymentIntent.id, chargeId);
    }
  }

  private async upsertTransaction(input: UpsertStripeTransactionInput): Promise<void> {
    const relatedObjectIds = this.compactRelatedObjectIds(input.relatedObjectIds);
    const refs = this.compactObjectRefs([
      { type: input.providerObjectType, id: input.providerObjectId },
      ...(input.matchObjectRefs ?? []),
    ]);

    await this.getPool().query(
      `WITH refs AS (
         SELECT type, id
         FROM jsonb_to_recordset($22::JSONB) AS ref(type TEXT, id TEXT)
       ),
       matched AS (
         SELECT tx.id
         FROM payments.transactions AS tx
         WHERE tx.provider = 'stripe'
           AND tx.environment = $1
           AND ($6 = 'refund' OR tx.type <> 'refund')
           AND EXISTS (
             SELECT 1
             FROM refs
             WHERE refs.id IS NOT NULL
               AND (
                 (tx.provider_object_type = refs.type AND tx.provider_object_id = refs.id)
                 OR tx.related_object_ids->>refs.type = refs.id
               )
           )
         ORDER BY tx.created_at DESC
         LIMIT 1
       ),
       updated AS (
         UPDATE payments.transactions AS tx
         SET type = $6,
             status = $7,
             subject_type = COALESCE($8, tx.subject_type),
             subject_id = COALESCE($9, tx.subject_id),
             provider_customer_id = COALESCE($10, tx.provider_customer_id),
             customer_email_snapshot = COALESCE($11, tx.customer_email_snapshot),
             provider_object_type = $2,
             provider_object_id = $3,
             provider_parent_object_type = COALESCE($4, tx.provider_parent_object_type),
             provider_parent_object_id = COALESCE($5, tx.provider_parent_object_id),
             related_object_ids = tx.related_object_ids || $12::JSONB,
             amount = $13,
             amount_refunded = COALESCE($14, tx.amount_refunded, 0),
             currency = $15,
             description = COALESCE($16, tx.description),
             paid_at = COALESCE($17, tx.paid_at),
             failed_at = COALESCE($18, tx.failed_at),
             refunded_at = COALESCE($19, tx.refunded_at),
             provider_created_at = COALESCE($20, tx.provider_created_at),
             raw = $21,
             updated_at = NOW()
         FROM matched
         WHERE tx.id = matched.id
         RETURNING tx.id
       )
       INSERT INTO payments.transactions AS tx (
         provider,
         environment,
         provider_object_type,
         provider_object_id,
         provider_parent_object_type,
         provider_parent_object_id,
         type,
         status,
         subject_type,
         subject_id,
         provider_customer_id,
         customer_email_snapshot,
         related_object_ids,
         amount,
         amount_refunded,
         currency,
         description,
         paid_at,
         failed_at,
         refunded_at,
         provider_created_at,
         raw
       )
       SELECT
         'stripe',
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11,
         $12::JSONB,
         $13,
         COALESCE($14, 0),
         $15,
         $16,
         $17,
         $18,
         $19,
         $20,
         $21
       WHERE NOT EXISTS (SELECT 1 FROM updated)
       ON CONFLICT (provider, environment, provider_object_type, provider_object_id)
         WHERE provider_object_type IS NOT NULL
           AND provider_object_id IS NOT NULL
       DO UPDATE SET
         type = EXCLUDED.type,
         status = EXCLUDED.status,
         subject_type = COALESCE(EXCLUDED.subject_type, tx.subject_type),
         subject_id = COALESCE(EXCLUDED.subject_id, tx.subject_id),
         provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, tx.provider_customer_id),
         customer_email_snapshot = COALESCE(EXCLUDED.customer_email_snapshot, tx.customer_email_snapshot),
         provider_parent_object_type = COALESCE(EXCLUDED.provider_parent_object_type, tx.provider_parent_object_type),
         provider_parent_object_id = COALESCE(EXCLUDED.provider_parent_object_id, tx.provider_parent_object_id),
         related_object_ids = tx.related_object_ids || EXCLUDED.related_object_ids,
         amount = EXCLUDED.amount,
         amount_refunded = EXCLUDED.amount_refunded,
         currency = EXCLUDED.currency,
         description = COALESCE(EXCLUDED.description, tx.description),
         paid_at = COALESCE(EXCLUDED.paid_at, tx.paid_at),
         failed_at = COALESCE(EXCLUDED.failed_at, tx.failed_at),
         refunded_at = COALESCE(EXCLUDED.refunded_at, tx.refunded_at),
         provider_created_at = COALESCE(EXCLUDED.provider_created_at, tx.provider_created_at),
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        input.environment,
        input.providerObjectType,
        input.providerObjectId,
        input.providerParentObjectType ?? null,
        input.providerParentObjectId ?? null,
        input.type,
        input.status,
        input.subject?.type ?? null,
        input.subject?.id ?? null,
        input.providerCustomerId,
        input.customerEmailSnapshot,
        JSON.stringify(relatedObjectIds),
        input.amount,
        input.amountRefunded ?? null,
        input.currency,
        input.description,
        input.paidAt,
        input.failedAt,
        input.refundedAt,
        input.providerCreatedAt,
        input.raw,
        JSON.stringify(refs),
      ]
    );
  }

  private async refreshOriginalTransactionRefundState(
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
         FROM payments.transactions
         WHERE provider = 'stripe'
           AND environment = $1
           AND type = 'refund'
           AND (
             ($2::TEXT IS NOT NULL AND provider_parent_object_type = 'payment_intent' AND provider_parent_object_id = $2)
             OR ($3::TEXT IS NOT NULL AND provider_parent_object_type = 'charge' AND provider_parent_object_id = $3)
             OR ($2::TEXT IS NOT NULL AND related_object_ids->>'payment_intent' = $2)
             OR ($3::TEXT IS NOT NULL AND related_object_ids->>'charge' = $3)
           )
       ),
       original_context AS (
         SELECT
           subject_type,
           subject_id,
           provider_customer_id,
           customer_email_snapshot,
           related_object_ids,
           description
         FROM payments.transactions
         WHERE provider = 'stripe'
           AND environment = $1
           AND type <> 'refund'
           AND (
             ($2::TEXT IS NOT NULL AND provider_object_type = 'payment_intent' AND provider_object_id = $2)
             OR ($3::TEXT IS NOT NULL AND provider_object_type = 'charge' AND provider_object_id = $3)
             OR ($2::TEXT IS NOT NULL AND related_object_ids->>'payment_intent' = $2)
             OR ($3::TEXT IS NOT NULL AND related_object_ids->>'charge' = $3)
           )
         ORDER BY created_at DESC
         LIMIT 1
       ),
       updated_original AS (
         UPDATE payments.transactions original
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
         WHERE original.provider = 'stripe'
           AND original.environment = $1
           AND original.type <> 'refund'
           AND (
             ($2::TEXT IS NOT NULL AND original.provider_object_type = 'payment_intent' AND original.provider_object_id = $2)
             OR ($3::TEXT IS NOT NULL AND original.provider_object_type = 'charge' AND original.provider_object_id = $3)
             OR ($2::TEXT IS NOT NULL AND original.related_object_ids->>'payment_intent' = $2)
             OR ($3::TEXT IS NOT NULL AND original.related_object_ids->>'charge' = $3)
           )
         RETURNING original.id
       )
       UPDATE payments.transactions refund
       SET subject_type = COALESCE(refund.subject_type, original_context.subject_type),
           subject_id = COALESCE(refund.subject_id, original_context.subject_id),
           provider_customer_id = COALESCE(refund.provider_customer_id, original_context.provider_customer_id),
           customer_email_snapshot = COALESCE(refund.customer_email_snapshot, original_context.customer_email_snapshot),
           related_object_ids = refund.related_object_ids || original_context.related_object_ids,
           description = COALESCE(refund.description, original_context.description),
           updated_at = NOW()
       FROM original_context
       WHERE refund.provider = 'stripe'
         AND refund.environment = $1
         AND refund.type = 'refund'
         AND (
           ($2::TEXT IS NOT NULL AND refund.provider_parent_object_type = 'payment_intent' AND refund.provider_parent_object_id = $2)
           OR ($3::TEXT IS NOT NULL AND refund.provider_parent_object_type = 'charge' AND refund.provider_parent_object_id = $3)
           OR ($2::TEXT IS NOT NULL AND refund.related_object_ids->>'payment_intent' = $2)
           OR ($3::TEXT IS NOT NULL AND refund.related_object_ids->>'charge' = $3)
         )`,
      [environment, paymentIntentId, chargeId]
    );
  }

  private async upsertOriginalTransactionForRefund(
    environment: StripeEnvironment,
    stripeContext: RefundStripeContext
  ): Promise<void> {
    if (stripeContext.invoice) {
      await this.upsertInvoiceTransaction(environment, stripeContext.invoice, 'succeeded');
      return;
    }

    if (stripeContext.paymentIntent?.status === 'succeeded') {
      await this.processPaymentIntentTransaction(
        environment,
        stripeContext.paymentIntent,
        'succeeded'
      );
    }
  }

  private async buildRefundContextFromStripeContext(
    environment: StripeEnvironment,
    stripeContext: RefundStripeContext
  ): Promise<TransactionContext | null> {
    const { paymentIntent, charge, invoice } = stripeContext;
    const customerId =
      getStripeObjectId(invoice?.customer) ??
      getStripeObjectId(paymentIntent?.customer) ??
      getStripeObjectId(charge?.customer);
    const subject =
      getBillingSubjectFromProviderAttributes(paymentIntent?.metadata) ??
      getBillingSubjectFromProviderAttributes(charge?.metadata) ??
      (invoice ? await this.resolveInvoiceSubject(environment, invoice, customerId) : null) ??
      (customerId ? await this.findSubjectForStripeCustomer(environment, customerId) : null);
    const firstLine = invoice?.lines?.data?.[0] ?? null;
    const context: TransactionContext = {
      subjectType: subject?.type ?? null,
      subjectId: subject?.id ?? null,
      providerCustomerId: customerId,
      customerEmailSnapshot:
        invoice?.customer_email ??
        paymentIntent?.receipt_email ??
        charge?.billing_details?.email ??
        null,
      relatedObjectIds: this.compactRelatedObjectIds({
        payment_intent: paymentIntent?.id,
        charge: charge?.id,
        invoice: invoice?.id,
        subscription: invoice ? this.getInvoiceSubscriptionId(invoice) : null,
        product: invoice ? this.getInvoiceLineItemProductId(firstLine) : null,
        price: invoice ? this.getInvoiceLineItemPriceId(firstLine) : null,
      }),
      description:
        invoice?.description ?? paymentIntent?.description ?? charge?.description ?? null,
    };

    if (
      context.subjectType ||
      context.subjectId ||
      context.providerCustomerId ||
      context.customerEmailSnapshot ||
      Object.keys(context.relatedObjectIds).length > 0 ||
      context.description
    ) {
      return context;
    }

    return null;
  }

  private async findTransactionContextForRefund(
    environment: StripeEnvironment,
    paymentIntentId: string | null,
    chargeId: string | null
  ): Promise<TransactionContext | null> {
    if (!paymentIntentId && !chargeId) {
      return null;
    }

    const result = await this.getPool().query(
      `SELECT
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         provider_customer_id AS "providerCustomerId",
         customer_email_snapshot AS "customerEmailSnapshot",
         related_object_ids AS "relatedObjectIds",
         description
       FROM payments.transactions
       WHERE provider = 'stripe'
         AND environment = $1
         AND type <> 'refund'
         AND (
           ($2::TEXT IS NOT NULL AND provider_object_type = 'payment_intent' AND provider_object_id = $2)
           OR ($3::TEXT IS NOT NULL AND provider_object_type = 'charge' AND provider_object_id = $3)
           OR ($2::TEXT IS NOT NULL AND related_object_ids->>'payment_intent' = $2)
           OR ($3::TEXT IS NOT NULL AND related_object_ids->>'charge' = $3)
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [environment, paymentIntentId, chargeId]
    );

    return (result.rows[0] as TransactionContext | undefined) ?? null;
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
      getBillingSubjectFromProviderAttributes(parentMetadata) ??
      getBillingSubjectFromProviderAttributes(invoice.metadata) ??
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

  private mapRefundStatus(status: string | null): StripeTransactionStatus {
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

  private contextToSubject(context: TransactionContext | null): BillingSubject | null {
    if (!context?.subjectType || !context.subjectId) {
      return null;
    }

    return { type: context.subjectType, id: context.subjectId };
  }

  private compactRelatedObjectIds(
    input: Record<string, string | null | undefined>
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(input).filter((entry): entry is [string, string] => {
        const [, value] = entry;
        return typeof value === 'string' && value.length > 0;
      })
    );
  }

  private compactObjectRefs(refs: TransactionObjectRef[]): Array<{ type: string; id: string }> {
    const seen = new Set<string>();
    const compacted: Array<{ type: string; id: string }> = [];

    for (const ref of refs) {
      if (!ref.id) {
        continue;
      }

      const key = `${ref.type}:${ref.id}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      compacted.push({ type: ref.type, id: ref.id });
    }

    return compacted;
  }
}
