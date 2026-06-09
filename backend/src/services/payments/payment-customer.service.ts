import type { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import type { StripeProvider } from '@/providers/payments/stripe.provider.js';
import { fromStripeTimestamp } from '@/services/payments/helpers.js';
import { toISOString, toISOStringOrNull } from '@/utils/dates.js';
import type {
  PaymentCustomerListRow,
  PaymentCustomerRow,
  PaymentProvider,
  StripeCustomer,
  StripeCustomerListItem,
  StripeEnvironment,
} from '@/types/payments.js';
import type {
  ListPaymentCustomersRequest,
  ListPaymentCustomersResponse,
  PaymentCustomer,
  PaymentCustomerListItem,
} from '@insforge/shared-schemas';

type StripeCustomerLike =
  | StripeCustomer
  | StripeCustomerListItem
  | {
      id: string;
      email?: string | null;
      name?: string | null;
      phone?: string | null;
      deleted?: boolean;
      metadata?: Record<string, string>;
      created?: number | null;
    };

const CUSTOMER_SYNC_BATCH_SIZE = 100;

export class PaymentCustomerService {
  private static instance: PaymentCustomerService;
  private pool: Pool | null = null;

  static getInstance(): PaymentCustomerService {
    if (!PaymentCustomerService.instance) {
      PaymentCustomerService.instance = new PaymentCustomerService();
    }

    return PaymentCustomerService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async listCustomers(
    input: ListPaymentCustomersRequest,
    provider: PaymentProvider = 'stripe'
  ): Promise<ListPaymentCustomersResponse> {
    const result = await this.getPool().query(
      `WITH unique_customer_emails AS (
         SELECT
           environment,
           provider,
           LOWER(email) AS customer_email,
           MIN(provider_customer_id) AS provider_customer_id
         FROM payments.customers
         WHERE environment = $1
           AND provider = $3
           AND email IS NOT NULL
         GROUP BY environment, provider, LOWER(email)
         HAVING COUNT(*) = 1
       ),
       transaction_projection AS (
         SELECT
           environment,
           provider,
           provider_customer_id,
           customer_email_snapshot,
           type,
           status,
           amount,
           amount_refunded,
           currency,
           paid_at,
           provider_created_at AS provider_created_at,
           created_at
         FROM payments.transactions
       ),
       payment_totals_by_customer AS (
         SELECT
           environment,
           provider,
           provider_customer_id,
           COUNT(*) FILTER (
             WHERE type <> 'refund'
               AND status IN ('succeeded', 'refunded', 'partially_refunded')
           )::INT AS payments_count,
           MAX(COALESCE(paid_at, provider_created_at, created_at)) FILTER (
             WHERE type <> 'refund'
               AND status IN ('succeeded', 'refunded', 'partially_refunded')
           ) AS last_payment_at
           ,
           CASE
             WHEN COUNT(DISTINCT currency) FILTER (
               WHERE type <> 'refund'
                 AND status IN ('succeeded', 'refunded', 'partially_refunded')
                 AND currency IS NOT NULL
             ) = 1
             THEN SUM(GREATEST(COALESCE(amount, 0) - COALESCE(amount_refunded, 0), 0)) FILTER (
               WHERE type <> 'refund'
                 AND status IN ('succeeded', 'refunded', 'partially_refunded')
             )
             ELSE NULL
           END AS total_spend,
           CASE
             WHEN COUNT(DISTINCT currency) FILTER (
               WHERE type <> 'refund'
                 AND status IN ('succeeded', 'refunded', 'partially_refunded')
                 AND currency IS NOT NULL
             ) = 1
             THEN MIN(currency) FILTER (
               WHERE type <> 'refund'
                 AND status IN ('succeeded', 'refunded', 'partially_refunded')
                 AND currency IS NOT NULL
             )
             ELSE NULL
           END AS total_spend_currency
         FROM transaction_projection
         WHERE environment = $1
           AND provider = $3
           AND provider_customer_id IS NOT NULL
         GROUP BY environment, provider, provider_customer_id
       ),
       payment_totals_by_email AS (
         SELECT
           environment,
           provider,
           LOWER(customer_email_snapshot) AS customer_email,
           COUNT(*) FILTER (
             WHERE type <> 'refund'
               AND status IN ('succeeded', 'refunded', 'partially_refunded')
           )::INT AS payments_count,
           MAX(COALESCE(paid_at, provider_created_at, created_at)) FILTER (
             WHERE type <> 'refund'
               AND status IN ('succeeded', 'refunded', 'partially_refunded')
           ) AS last_payment_at,
           CASE
             WHEN COUNT(DISTINCT currency) FILTER (
               WHERE type <> 'refund'
                 AND status IN ('succeeded', 'refunded', 'partially_refunded')
                 AND currency IS NOT NULL
             ) = 1
             THEN SUM(GREATEST(COALESCE(amount, 0) - COALESCE(amount_refunded, 0), 0)) FILTER (
               WHERE type <> 'refund'
                 AND status IN ('succeeded', 'refunded', 'partially_refunded')
             )
             ELSE NULL
           END AS total_spend,
           CASE
             WHEN COUNT(DISTINCT currency) FILTER (
               WHERE type <> 'refund'
                 AND status IN ('succeeded', 'refunded', 'partially_refunded')
                 AND currency IS NOT NULL
             ) = 1
             THEN MIN(currency) FILTER (
               WHERE type <> 'refund'
                 AND status IN ('succeeded', 'refunded', 'partially_refunded')
                 AND currency IS NOT NULL
             )
             ELSE NULL
           END AS total_spend_currency
         FROM transaction_projection
         WHERE environment = $1
           AND provider = $3
           AND provider_customer_id IS NULL
           AND customer_email_snapshot IS NOT NULL
         GROUP BY environment, provider, LOWER(customer_email_snapshot)
       )
       SELECT
         customers.environment,
         customers.provider,
         customers.provider_customer_id AS "providerCustomerId",
         customers.email,
         customers.name,
         customers.phone,
         customers.deleted,
         customers.metadata,
         customers.raw,
         customers.provider_created_at AS "providerCreatedAt",
         customers.synced_at AS "syncedAt",
         COALESCE(payment_totals_by_customer.payments_count, 0)
           + COALESCE(payment_totals_by_email.payments_count, 0) AS "paymentsCount",
         CASE
           WHEN payment_totals_by_customer.last_payment_at IS NULL
             THEN payment_totals_by_email.last_payment_at
           WHEN payment_totals_by_email.last_payment_at IS NULL
             THEN payment_totals_by_customer.last_payment_at
           ELSE GREATEST(
             payment_totals_by_customer.last_payment_at,
             payment_totals_by_email.last_payment_at
           )
         END AS "lastPaymentAt",
         CASE
           WHEN COALESCE(payment_totals_by_customer.payments_count, 0) = 0
             THEN payment_totals_by_email.total_spend
           WHEN COALESCE(payment_totals_by_email.payments_count, 0) = 0
             THEN payment_totals_by_customer.total_spend
           WHEN payment_totals_by_customer.total_spend IS NOT NULL
             AND payment_totals_by_email.total_spend IS NOT NULL
             AND payment_totals_by_customer.total_spend_currency = payment_totals_by_email.total_spend_currency
             THEN payment_totals_by_customer.total_spend + payment_totals_by_email.total_spend
           ELSE NULL
         END AS "totalSpend",
         CASE
           WHEN COALESCE(payment_totals_by_customer.payments_count, 0) = 0
             THEN payment_totals_by_email.total_spend_currency
           WHEN COALESCE(payment_totals_by_email.payments_count, 0) = 0
             THEN payment_totals_by_customer.total_spend_currency
           WHEN payment_totals_by_customer.total_spend IS NOT NULL
             AND payment_totals_by_email.total_spend IS NOT NULL
             AND payment_totals_by_customer.total_spend_currency = payment_totals_by_email.total_spend_currency
             THEN payment_totals_by_customer.total_spend_currency
           ELSE NULL
         END AS "totalSpendCurrency"
       FROM payments.customers AS customers
       LEFT JOIN payment_totals_by_customer
         ON payment_totals_by_customer.environment = customers.environment
        AND payment_totals_by_customer.provider = customers.provider
        AND payment_totals_by_customer.provider_customer_id = customers.provider_customer_id
       LEFT JOIN unique_customer_emails
         ON unique_customer_emails.environment = customers.environment
        AND unique_customer_emails.provider = customers.provider
        AND unique_customer_emails.provider_customer_id = customers.provider_customer_id
       LEFT JOIN payment_totals_by_email
         ON payment_totals_by_email.environment = unique_customer_emails.environment
        AND payment_totals_by_email.provider = unique_customer_emails.provider
        AND payment_totals_by_email.customer_email = unique_customer_emails.customer_email
       WHERE customers.environment = $1
         AND customers.provider = $3
       ORDER BY customers.deleted ASC, customers.provider, COALESCE(customers.email, customers.name, customers.provider_customer_id), customers.provider_customer_id
       LIMIT $2`,
      [input.environment, input.limit, provider]
    );

    return {
      customers: (result.rows as PaymentCustomerListRow[]).map((row) =>
        this.normalizeCustomerListRow(row)
      ),
    };
  }

  async syncCustomersWithProvider(
    environment: StripeEnvironment,
    provider: StripeProvider
  ): Promise<number> {
    const customers = await provider.listCustomers();
    const syncedAt = new Date();
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      for (let start = 0; start < customers.length; start += CUSTOMER_SYNC_BATCH_SIZE) {
        await this.bulkUpsertCustomerRecords(
          client,
          environment,
          customers.slice(start, start + CUSTOMER_SYNC_BATCH_SIZE),
          syncedAt
        );
      }

      await this.markMissingCustomersDeleted(
        client,
        environment,
        customers.map((customer) => customer.id),
        syncedAt
      );

      await client.query('COMMIT');
      return customers.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertCustomerProjection(
    environment: StripeEnvironment,
    customer: StripeCustomerLike
  ): Promise<boolean> {
    if (!customer.id) {
      return false;
    }

    await this.getPool().query(
      this.buildUpsertCustomerSql(),
      this.buildUpsertCustomerParams(environment, customer, new Date(), customer.deleted === true)
    );

    return true;
  }

  private async bulkUpsertCustomerRecords(
    client: PoolClient,
    environment: StripeEnvironment,
    customers: StripeCustomerLike[],
    syncedAt: Date
  ): Promise<void> {
    if (customers.length === 0) {
      return;
    }

    await client.query(
      this.buildBulkUpsertCustomerSql(customers.length),
      this.buildBulkUpsertCustomerParams(environment, customers, syncedAt)
    );
  }

  private async markMissingCustomersDeleted(
    client: PoolClient,
    environment: StripeEnvironment,
    syncedCustomerIds: string[],
    syncedAt: Date
  ): Promise<void> {
    await client.query(
      `UPDATE payments.customers
       SET deleted = true,
           synced_at = $2,
           updated_at = NOW()
       WHERE environment = $1
         AND provider = 'stripe'
         AND deleted = false
         AND NOT (provider_customer_id = ANY($3::TEXT[]))`,
      [environment, syncedAt, syncedCustomerIds]
    );
  }

  private buildBulkUpsertCustomerSql(customerCount: number): string {
    const values = Array.from({ length: customerCount }, (_, index) => {
      const offset = index * 10;
      return `('stripe', $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`;
    }).join(',\n    ');

    return `INSERT INTO payments.customers (
      provider,
      environment,
      provider_customer_id,
      email,
      name,
      phone,
      deleted,
      metadata,
      raw,
      provider_created_at,
      synced_at
    )
    VALUES ${values}
    ON CONFLICT (provider, environment, provider_customer_id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      phone = EXCLUDED.phone,
      deleted = EXCLUDED.deleted,
      metadata = EXCLUDED.metadata,
      raw = EXCLUDED.raw,
      provider_created_at = EXCLUDED.provider_created_at,
      synced_at = EXCLUDED.synced_at,
      updated_at = NOW()`;
  }

  private buildUpsertCustomerSql(): string {
    return `INSERT INTO payments.customers (
      provider,
      environment,
      provider_customer_id,
      email,
      name,
      phone,
      deleted,
      metadata,
      raw,
      provider_created_at,
      synced_at
    )
    VALUES ('stripe', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (provider, environment, provider_customer_id) DO UPDATE SET
      email = CASE WHEN $11 THEN payments.customers.email ELSE EXCLUDED.email END,
      name = CASE WHEN $11 THEN payments.customers.name ELSE EXCLUDED.name END,
      phone = CASE WHEN $11 THEN payments.customers.phone ELSE EXCLUDED.phone END,
      deleted = EXCLUDED.deleted,
      metadata = CASE WHEN $11 THEN payments.customers.metadata ELSE EXCLUDED.metadata END,
      raw = CASE WHEN $11 THEN payments.customers.raw ELSE EXCLUDED.raw END,
      provider_created_at = CASE
        WHEN $11 THEN COALESCE(payments.customers.provider_created_at, EXCLUDED.provider_created_at)
        ELSE EXCLUDED.provider_created_at
      END,
      synced_at = EXCLUDED.synced_at,
      updated_at = NOW()`;
  }

  private buildBulkUpsertCustomerParams(
    environment: StripeEnvironment,
    customers: StripeCustomerLike[],
    syncedAt: Date
  ): Array<
    StripeEnvironment | string | boolean | Record<string, string> | StripeCustomerLike | Date | null
  > {
    return customers.flatMap((customer) => {
      const params = this.buildUpsertCustomerParams(environment, customer, syncedAt, false);
      return params.slice(0, 10);
    });
  }

  private buildUpsertCustomerParams(
    environment: StripeEnvironment,
    customer: StripeCustomerLike,
    syncedAt: Date,
    preserveExistingDetails: boolean
  ): [
    StripeEnvironment,
    string,
    string | null,
    string | null,
    string | null,
    boolean,
    Record<string, string>,
    StripeCustomerLike,
    Date | null,
    Date,
    boolean,
  ] {
    return [
      environment,
      customer.id,
      customer.email ?? null,
      customer.name ?? null,
      customer.phone ?? null,
      customer.deleted === true,
      customer.deleted === true ? {} : (customer.metadata ?? {}),
      customer,
      fromStripeTimestamp(customer.created ?? null),
      syncedAt,
      preserveExistingDetails,
    ];
  }

  private normalizeCustomerRow(row: PaymentCustomerRow): PaymentCustomer {
    return {
      environment: row.environment,
      provider: row.provider ?? 'stripe',
      providerCustomerId: row.providerCustomerId,
      email: row.email ?? null,
      name: row.name ?? null,
      phone: row.phone ?? null,
      deleted: row.deleted,
      metadata: row.metadata ?? {},
      providerCreatedAt: toISOStringOrNull(row.providerCreatedAt),
      syncedAt: toISOString(row.syncedAt),
    };
  }

  private normalizeCustomerListRow(row: PaymentCustomerListRow): PaymentCustomerListItem {
    const paymentMethod = this.extractDefaultPaymentMethod(row.raw);

    return {
      ...this.normalizeCustomerRow(row),
      paymentsCount: row.paymentsCount,
      lastPaymentAt: toISOStringOrNull(row.lastPaymentAt),
      totalSpend: row.totalSpend === null ? null : Number(row.totalSpend),
      totalSpendCurrency: row.totalSpendCurrency ?? null,
      paymentMethodBrand: paymentMethod.brand,
      paymentMethodLast4: paymentMethod.last4,
      countryCode: this.extractCountryCode(row.raw),
    };
  }

  private extractCountryCode(raw: unknown): string | null {
    if (!this.isRecord(raw)) {
      return null;
    }

    const country =
      this.readString(this.readRecord(raw.address)?.country) ??
      this.readString(this.readRecord(this.readRecord(raw.shipping)?.address)?.country);

    if (!country) {
      return null;
    }

    const normalizedCountry = country.trim().toUpperCase();
    return normalizedCountry.length === 2 ? normalizedCountry : null;
  }

  private extractDefaultPaymentMethod(raw: unknown): {
    brand: string | null;
    last4: string | null;
  } {
    if (!this.isRecord(raw)) {
      return { brand: null, last4: null };
    }

    const paymentMethodCard = this.readRecord(
      this.readRecord(this.readRecord(raw.invoice_settings)?.default_payment_method)?.card
    );
    const sourceCard = this.readRecord(raw.default_source);
    const card = paymentMethodCard ?? sourceCard;

    return {
      brand: this.readString(card?.brand)?.trim().toLowerCase() ?? null,
      last4: this.readString(card?.last4)?.trim() ?? null,
    };
  }

  private readRecord(value: unknown): Record<string, unknown> | null {
    return this.isRecord(value) ? value : null;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private normalizeCountryCode(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const normalizedCountry = value.trim().toUpperCase();
    return normalizedCountry.length === 2 ? normalizedCountry : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
