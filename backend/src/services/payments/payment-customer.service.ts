import type { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import type { StripeProvider } from '@/providers/payments/stripe.provider.js';
import { fromStripeTimestamp, toISOString, toISOStringOrNull } from '@/services/payments/helpers.js';
import type {
  StripeCustomer,
  StripeCustomerListItem,
  StripeCustomerRow,
  StripeEnvironment,
} from '@/types/payments.js';
import type {
  ListPaymentCustomersRequest,
  ListPaymentCustomersResponse,
  StripeCustomerMirror,
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

  async listCustomers(input: ListPaymentCustomersRequest): Promise<ListPaymentCustomersResponse> {
    const result = await this.getPool().query(
      `SELECT
         environment,
         stripe_customer_id AS "stripeCustomerId",
         email,
         name,
         phone,
         deleted,
         metadata,
         stripe_created_at AS "stripeCreatedAt",
         synced_at AS "syncedAt"
       FROM payments.customers
       WHERE environment = $1
       ORDER BY deleted ASC, COALESCE(email, name, stripe_customer_id), stripe_customer_id
       LIMIT $2`,
      [input.environment, input.limit]
    );

    return {
      customers: (result.rows as StripeCustomerRow[]).map((row) => this.normalizeCustomerRow(row)),
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

      for (const customer of customers) {
        await this.upsertCustomerMirror(client, environment, customer, syncedAt, false);
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
      this.buildUpsertCustomerParams(
        environment,
        customer,
        new Date(),
        customer.deleted === true
      )
    );

    return true;
  }

  private async upsertCustomerMirror(
    client: PoolClient,
    environment: StripeEnvironment,
    customer: StripeCustomerLike,
    syncedAt: Date,
    preserveExistingDetails: boolean
  ): Promise<void> {
    await client.query(
      this.buildUpsertCustomerSql(),
      this.buildUpsertCustomerParams(environment, customer, syncedAt, preserveExistingDetails)
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
         AND deleted = false
         AND NOT (stripe_customer_id = ANY($3::TEXT[]))`,
      [environment, syncedAt, syncedCustomerIds]
    );
  }

  private buildUpsertCustomerSql(): string {
    return `INSERT INTO payments.customers (
      environment,
      stripe_customer_id,
      email,
      name,
      phone,
      deleted,
      metadata,
      raw,
      stripe_created_at,
      synced_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (environment, stripe_customer_id) DO UPDATE SET
      email = CASE WHEN $11 THEN payments.customers.email ELSE EXCLUDED.email END,
      name = CASE WHEN $11 THEN payments.customers.name ELSE EXCLUDED.name END,
      phone = CASE WHEN $11 THEN payments.customers.phone ELSE EXCLUDED.phone END,
      deleted = EXCLUDED.deleted,
      metadata = CASE WHEN $11 THEN payments.customers.metadata ELSE EXCLUDED.metadata END,
      raw = EXCLUDED.raw,
      stripe_created_at = CASE
        WHEN $11 THEN COALESCE(payments.customers.stripe_created_at, EXCLUDED.stripe_created_at)
        ELSE EXCLUDED.stripe_created_at
      END,
      synced_at = EXCLUDED.synced_at,
      updated_at = NOW()`;
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

  private normalizeCustomerRow(row: StripeCustomerRow): StripeCustomerMirror {
    return {
      environment: row.environment,
      stripeCustomerId: row.stripeCustomerId,
      email: row.email ?? null,
      name: row.name ?? null,
      phone: row.phone ?? null,
      deleted: row.deleted,
      metadata: row.metadata ?? {},
      stripeCreatedAt: toISOStringOrNull(row.stripeCreatedAt),
      syncedAt: toISOString(row.syncedAt),
    };
  }
}
