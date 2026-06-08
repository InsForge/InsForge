import type { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { getBillingSubjectFromMetadata } from '@/services/payments/helpers.js';
import type { RazorpayInvoice, RazorpayPayment } from '@/providers/payments/razorpay.provider.js';
import type { RazorpayEnvironment } from '@/types/payments.js';
import type { BillingSubject } from '@insforge/shared-schemas';

export type RazorpayTransactionStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

type RazorpayTransactionType =
  | 'one_time_payment'
  | 'subscription_invoice'
  | 'refund'
  | 'failed_payment';

interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  created_at: number;
}

interface TransactionObjectRef {
  type: string;
  id: string | null;
}

interface UpsertRazorpayTransactionInput {
  environment: RazorpayEnvironment;
  type: RazorpayTransactionType;
  status: RazorpayTransactionStatus;
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

interface UpsertRazorpayPaymentOptions {
  invoiceId?: string | null;
  orderId?: string | null;
  subscriptionId?: string | null;
  subjectFallback?: BillingSubject | null;
  descriptionFallback?: string | null;
}

export class RazorpayTransactionService {
  private static instance: RazorpayTransactionService;
  private pool: Pool | null = null;

  static getInstance(): RazorpayTransactionService {
    if (!RazorpayTransactionService.instance) {
      RazorpayTransactionService.instance = new RazorpayTransactionService();
    }

    return RazorpayTransactionService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async upsertPayments(
    environment: RazorpayEnvironment,
    payments: RazorpayPayment[]
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      for (const payment of payments) {
        await this.upsertPaymentWithClient(client, environment, payment);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async upsertPaymentTransaction(
    environment: RazorpayEnvironment,
    payment: RazorpayPayment,
    options: UpsertRazorpayPaymentOptions = {}
  ): Promise<RazorpayTransactionStatus> {
    return this.upsertPaymentWithClient(this.getPool(), environment, payment, options);
  }

  async upsertRefundTransaction(
    environment: RazorpayEnvironment,
    refund: RazorpayRefund,
    status: RazorpayTransactionStatus
  ): Promise<void> {
    await this.upsertTransaction(this.getPool(), {
      environment,
      type: 'refund',
      status,
      subject: null,
      providerCustomerId: null,
      customerEmailSnapshot: null,
      providerObjectType: 'refund',
      providerObjectId: refund.id,
      providerParentObjectType: 'payment',
      providerParentObjectId: refund.payment_id,
      relatedObjectIds: {
        refund: refund.id,
        payment: refund.payment_id,
      },
      amount: refund.amount,
      amountRefunded: refund.amount,
      currency: refund.currency.toLowerCase(),
      description: null,
      paidAt: null,
      failedAt: status === 'failed' ? this.fromRazorpayTimestamp(refund.created_at) : null,
      refundedAt: status === 'refunded' ? this.fromRazorpayTimestamp(refund.created_at) : null,
      providerCreatedAt: this.fromRazorpayTimestamp(refund.created_at),
      raw: refund,
      matchObjectRefs: [{ type: 'refund', id: refund.id }],
    });

    await this.refreshOriginalPaymentRefundState(environment, refund.payment_id);
  }

  async upsertInvoiceTransaction(
    environment: RazorpayEnvironment,
    invoice: RazorpayInvoice,
    event: string
  ): Promise<void> {
    const metadata = this.normalizeMetadata(invoice.notes);
    const customerId = invoice.customer_id ?? invoice.customer_details?.id ?? null;
    const subject =
      getBillingSubjectFromMetadata(metadata) ??
      (await this.resolveSubjectFromCustomerMapping(this.getPool(), environment, customerId));
    const status = this.mapInvoiceStatus(invoice.status, event);
    const amount =
      status === 'succeeded' && invoice.amount_paid > 0 ? invoice.amount_paid : invoice.amount;
    const description =
      invoice.description ??
      invoice.line_items?.[0]?.name ??
      invoice.line_items?.[0]?.description ??
      null;
    const type = invoice.subscription_id
      ? 'subscription_invoice'
      : status === 'failed'
        ? 'failed_payment'
        : 'one_time_payment';

    await this.upsertTransaction(this.getPool(), {
      environment,
      type,
      status,
      subject,
      providerCustomerId: customerId,
      customerEmailSnapshot: invoice.customer_details?.email ?? null,
      providerObjectType: 'invoice',
      providerObjectId: invoice.id,
      relatedObjectIds: {
        invoice: invoice.id,
        order: invoice.order_id,
        subscription: invoice.subscription_id,
      },
      amount,
      amountRefunded: 0,
      currency: invoice.currency.toLowerCase(),
      description,
      paidAt:
        status === 'succeeded'
          ? (this.fromRazorpayTimestamp(invoice.paid_at) ??
            this.fromRazorpayTimestamp(invoice.created_at))
          : null,
      failedAt:
        status === 'failed'
          ? (this.fromRazorpayTimestamp(invoice.expired_at) ??
            this.fromRazorpayTimestamp(invoice.cancelled_at) ??
            this.fromRazorpayTimestamp(invoice.created_at))
          : null,
      refundedAt: null,
      providerCreatedAt: this.fromRazorpayTimestamp(invoice.created_at),
      raw: invoice,
      matchObjectRefs: [
        { type: 'invoice', id: invoice.id },
        { type: 'order', id: invoice.order_id ?? null },
      ],
    });
  }

  private async upsertPaymentWithClient(
    client: Pool | PoolClient,
    environment: RazorpayEnvironment,
    payment: RazorpayPayment,
    options: UpsertRazorpayPaymentOptions = {}
  ): Promise<RazorpayTransactionStatus> {
    const status = this.mapPaymentStatus(payment.status);
    const metadata = this.normalizeMetadata(payment.notes);
    const invoiceId = payment.invoice_id ?? options.invoiceId ?? null;
    const orderId = payment.order_id ?? options.orderId ?? null;
    const subscriptionId = options.subscriptionId ?? null;
    const subject =
      getBillingSubjectFromMetadata(metadata) ??
      options.subjectFallback ??
      (await this.resolveSubjectFromOrder(client, environment, orderId)) ??
      (await this.resolveSubjectFromCustomerMapping(client, environment, payment.customer_id));
    const type = invoiceId || subscriptionId
      ? 'subscription_invoice'
      : status === 'failed'
        ? 'failed_payment'
        : 'one_time_payment';

    await this.upsertTransaction(client, {
      environment,
      type,
      status,
      subject,
      providerCustomerId: payment.customer_id ?? null,
      customerEmailSnapshot: payment.email ?? null,
      providerObjectType: 'payment',
      providerObjectId: payment.id,
      relatedObjectIds: {
        payment: payment.id,
        invoice: invoiceId,
        order: orderId,
        subscription: subscriptionId,
      },
      amount: payment.amount,
      amountRefunded: payment.amount_refunded ?? 0,
      currency: payment.currency.toLowerCase(),
      description: payment.description ?? options.descriptionFallback ?? null,
      paidAt: status === 'succeeded' ? this.fromRazorpayTimestamp(payment.created_at) : null,
      failedAt: status === 'failed' ? this.fromRazorpayTimestamp(payment.created_at) : null,
      refundedAt:
        status === 'refunded' || status === 'partially_refunded'
          ? this.fromRazorpayTimestamp(payment.created_at)
          : null,
      providerCreatedAt: this.fromRazorpayTimestamp(payment.created_at),
      raw: payment,
      matchObjectRefs: [
        { type: 'payment', id: payment.id },
        { type: 'order', id: orderId },
        { type: 'invoice', id: invoiceId },
      ],
    });

    return status;
  }

  private async upsertTransaction(
    client: Pool | PoolClient,
    input: UpsertRazorpayTransactionInput
  ): Promise<void> {
    const relatedObjectIds = this.compactRelatedObjectIds(input.relatedObjectIds);
    const refs = this.compactObjectRefs([
      { type: input.providerObjectType, id: input.providerObjectId },
      ...(input.matchObjectRefs ?? []),
    ]);

    await client.query(
      `WITH refs AS (
         SELECT type, id
         FROM jsonb_to_recordset($22::JSONB) AS ref(type TEXT, id TEXT)
       ),
       matched AS (
         SELECT tx.id
         FROM payments.transactions AS tx
         WHERE tx.provider = 'razorpay'
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
         RETURNING id
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
         'razorpay',
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

  private async refreshOriginalPaymentRefundState(
    environment: RazorpayEnvironment,
    paymentId: string
  ): Promise<void> {
    await this.getPool().query(
      `WITH refund_totals AS (
         SELECT
           COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::BIGINT AS amount_refunded,
           MAX(refunded_at) FILTER (WHERE status = 'refunded') AS refunded_at
         FROM payments.transactions
         WHERE provider = 'razorpay'
           AND environment = $1
           AND type = 'refund'
           AND (
             (provider_parent_object_type = 'payment' AND provider_parent_object_id = $2)
             OR related_object_ids->>'payment' = $2
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
         WHERE provider = 'razorpay'
           AND environment = $1
           AND type <> 'refund'
           AND (
             (provider_object_type = 'payment' AND provider_object_id = $2)
             OR related_object_ids->>'payment' = $2
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
         WHERE original.provider = 'razorpay'
           AND original.environment = $1
           AND original.type <> 'refund'
           AND (
             (original.provider_object_type = 'payment' AND original.provider_object_id = $2)
             OR original.related_object_ids->>'payment' = $2
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
       WHERE refund.provider = 'razorpay'
         AND refund.environment = $1
         AND refund.type = 'refund'
         AND (
           (refund.provider_parent_object_type = 'payment' AND refund.provider_parent_object_id = $2)
           OR refund.related_object_ids->>'payment' = $2
         )`,
      [environment, paymentId]
    );
  }

  private async resolveSubjectFromOrder(
    client: Pool | PoolClient,
    environment: RazorpayEnvironment,
    orderId: string | null
  ): Promise<BillingSubject | null> {
    if (!orderId) {
      return null;
    }

    const result = await client.query(
      `SELECT subject_type AS "type", subject_id AS "id"
       FROM payments.razorpay_orders
       WHERE environment = $1
         AND order_id = $2
         AND subject_type IS NOT NULL
         AND subject_id IS NOT NULL
       LIMIT 1`,
      [environment, orderId]
    );

    return (result.rows[0] as BillingSubject | undefined) ?? null;
  }

  private async resolveSubjectFromCustomerMapping(
    client: Pool | PoolClient,
    environment: RazorpayEnvironment,
    customerId: string | null
  ): Promise<BillingSubject | null> {
    if (!customerId) {
      return null;
    }

    const result = await client.query(
      `SELECT subject_type AS "type", subject_id AS "id"
       FROM payments.customer_mappings
       WHERE provider = 'razorpay'
         AND environment = $1
         AND provider_customer_id = $2
       LIMIT 1`,
      [environment, customerId]
    );

    return (result.rows[0] as BillingSubject | undefined) ?? null;
  }

  private normalizeMetadata(
    notes: Record<string, string | number | boolean> | undefined | null
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(notes ?? {}).map(([key, value]) => [key, String(value)])
    );
  }

  private fromRazorpayTimestamp(unixSeconds: number | null | undefined): Date | null {
    return unixSeconds ? new Date(unixSeconds * 1000) : null;
  }

  private mapPaymentStatus(status: RazorpayPayment['status']): RazorpayTransactionStatus {
    switch (status) {
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

  private mapInvoiceStatus(
    status: RazorpayInvoice['status'],
    event: string
  ): RazorpayTransactionStatus {
    switch (status) {
      case 'paid':
        return 'succeeded';
      case 'expired':
      case 'cancelled':
        return 'failed';
      case 'partially_paid':
      case 'issued':
      case 'draft':
        return 'pending';
      default:
        return event === 'invoice.paid' ? 'succeeded' : 'failed';
    }
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
