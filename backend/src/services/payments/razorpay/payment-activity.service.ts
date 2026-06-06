import type { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { normalizePaymentActivityRow } from '@/services/payments/helpers.js';
import type { RazorpayPayment } from '@/providers/payments/razorpay.provider.js';
import type { PaymentActivityRow, RazorpayEnvironment } from '@/types/payments.js';
import type {
  ListPaymentActivityRequest,
  ListPaymentActivityResponse,
} from '@insforge/shared-schemas';

type RazorpayPaymentActivityStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export class RazorpayPaymentActivityService {
  private static instance: RazorpayPaymentActivityService;
  private pool: Pool | null = null;

  static getInstance(): RazorpayPaymentActivityService {
    if (!RazorpayPaymentActivityService.instance) {
      RazorpayPaymentActivityService.instance = new RazorpayPaymentActivityService();
    }

    return RazorpayPaymentActivityService.instance;
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
         'razorpay'::TEXT AS provider,
         type,
         status,
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         customer_id AS "providerCustomerId",
         customer_email_snapshot AS "customerEmailSnapshot",
         CASE
           WHEN type = 'refund' THEN refund_id
           WHEN payment_id IS NOT NULL THEN payment_id
           WHEN order_id IS NOT NULL THEN order_id
           WHEN invoice_id IS NOT NULL THEN invoice_id
           ELSE subscription_id
         END AS "providerReferenceId",
         CASE
           WHEN type = 'refund' AND refund_id IS NOT NULL THEN 'refund'
           WHEN payment_id IS NOT NULL THEN 'payment'
           WHEN order_id IS NOT NULL THEN 'order'
           WHEN invoice_id IS NOT NULL THEN 'invoice'
           WHEN subscription_id IS NOT NULL THEN 'subscription'
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
       FROM payments.razorpay_payment_activity
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

  async upsertPayments(
    environment: RazorpayEnvironment,
    payments: RazorpayPayment[]
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      for (const payment of payments) {
        await this.upsertPayment(client, environment, payment);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async upsertPayment(
    client: PoolClient,
    environment: RazorpayEnvironment,
    payment: RazorpayPayment
  ): Promise<void> {
    const status = this.mapRazorpayPaymentStatus(payment.status);
    const paidAt =
      status === 'succeeded' && payment.created_at ? new Date(payment.created_at * 1000) : null;
    const failedAt =
      status === 'failed' && payment.created_at ? new Date(payment.created_at * 1000) : null;
    const refundedAt =
      (status === 'refunded' || status === 'partially_refunded') && payment.created_at
        ? new Date(payment.created_at * 1000)
        : null;
    const type = payment.invoice_id ? 'subscription_invoice' : 'one_time_payment';

    await client.query(
      `INSERT INTO payments.razorpay_payment_activity (
         environment,
         type,
         status,
         customer_id,
         customer_email_snapshot,
         payment_id,
         invoice_id,
         order_id,
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (environment, payment_id)
         WHERE payment_id IS NOT NULL
           AND type <> 'refund'
       DO UPDATE SET
         type = EXCLUDED.type,
         status = EXCLUDED.status,
         customer_id = EXCLUDED.customer_id,
         customer_email_snapshot = EXCLUDED.customer_email_snapshot,
         payment_id = EXCLUDED.payment_id,
         invoice_id = EXCLUDED.invoice_id,
         order_id = EXCLUDED.order_id,
         amount = EXCLUDED.amount,
         amount_refunded = EXCLUDED.amount_refunded,
         currency = EXCLUDED.currency,
         description = EXCLUDED.description,
         paid_at = EXCLUDED.paid_at,
         failed_at = EXCLUDED.failed_at,
         refunded_at = EXCLUDED.refunded_at,
         provider_created_at = EXCLUDED.provider_created_at,
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        environment,
        type,
        status,
        payment.customer_id ?? null,
        payment.email ?? null,
        payment.id,
        payment.invoice_id ?? null,
        payment.order_id ?? null,
        payment.amount,
        payment.amount_refunded ?? 0,
        payment.currency.toLowerCase(),
        payment.description ?? null,
        paidAt,
        failedAt,
        refundedAt,
        payment.created_at ? new Date(payment.created_at * 1000) : null,
        payment,
      ]
    );
  }

  private mapRazorpayPaymentStatus(
    rzpStatus: RazorpayPayment['status']
  ): RazorpayPaymentActivityStatus {
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
}
