import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { normalizePaymentTransactionRow } from '@/services/payments/helpers.js';
import type { PaymentProvider, PaymentTransactionRow } from '@/types/payments.js';
import type {
  ListPaymentTransactionsRequest,
  ListPaymentTransactionsResponse,
} from '@insforge/shared-schemas';

export class PaymentTransactionService {
  private static instance: PaymentTransactionService;
  private pool: Pool | null = null;

  static getInstance(): PaymentTransactionService {
    if (!PaymentTransactionService.instance) {
      PaymentTransactionService.instance = new PaymentTransactionService();
    }

    return PaymentTransactionService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async listTransactions(
    input: ListPaymentTransactionsRequest,
    provider?: PaymentProvider
  ): Promise<ListPaymentTransactionsResponse> {
    const params: Array<string | number> = [input.environment];
    const filters = ['environment = $1'];

    if (provider) {
      params.push(provider);
      filters.push(`provider = $${params.length}`);
    }

    if (input.subjectType && input.subjectId) {
      params.push(input.subjectType, input.subjectId);
      filters.push(`subject_type = $${params.length - 1}`, `subject_id = $${params.length}`);
    }

    params.push(input.limit);
    const result = await this.getPool().query(
      `SELECT
         environment,
         provider,
         type,
         status,
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         provider_customer_id AS "providerCustomerId",
         customer_email_snapshot AS "customerEmailSnapshot",
         provider_object_id AS "providerReferenceId",
         provider_object_type AS "providerReferenceType",
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
       FROM payments.transactions
       WHERE ${filters.join(' AND ')}
       ORDER BY COALESCE(provider_created_at, created_at) DESC
       LIMIT $${params.length}`,
      params
    );

    return {
      transactions: (result.rows as PaymentTransactionRow[]).map((row) =>
        normalizePaymentTransactionRow(row)
      ),
    };
  }
}
