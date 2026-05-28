import type { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { RazorpayConfigService } from '@/services/payments/razorpay-config.service.js';
import type {
  RazorpayProvider,
  RazorpayPlan,
  RazorpayItem,
  RazorpayCustomer,
  RazorpaySubscription,
  RazorpayPayment,
} from '@/providers/payments/razorpay.provider.js';
import { RAZORPAY_ENVIRONMENTS, type RazorpayEnvironment } from '@/types/payments.js';
import logger from '@/utils/logger.js';

export interface RazorpaySyncResult {
  environment: RazorpayEnvironment;
  plans: number;
  items: number;
  customers: number;
  subscriptions: number;
  payments: number;
  status: 'succeeded' | 'failed';
  error?: string;
}

export class RazorpaySyncService {
  private static instance: RazorpaySyncService;
  private pool: Pool | null = null;
  private readonly configService = RazorpayConfigService.getInstance();

  static getInstance(): RazorpaySyncService {
    if (!RazorpaySyncService.instance) {
      RazorpaySyncService.instance = new RazorpaySyncService();
    }
    return RazorpaySyncService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Full sync for one or all environments.
   * Pulls Plans → products, Items → prices, Customers, Subscriptions, Payments.
   */
  async syncAll(environmentInput: RazorpayEnvironment | 'all'): Promise<RazorpaySyncResult[]> {
    const environments = environmentInput === 'all' ? RAZORPAY_ENVIRONMENTS : [environmentInput];

    const results: RazorpaySyncResult[] = [];

    for (const environment of environments) {
      results.push(await this.syncEnvironment(environment));
    }

    return results;
  }

  private async syncEnvironment(environment: RazorpayEnvironment): Promise<RazorpaySyncResult> {
    let provider: RazorpayProvider;
    try {
      provider = await this.configService.createRazorpayProvider(environment);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Razorpay sync skipped — keys not configured', { environment, error: message });
      await this.configService.recordConnectionStatus(environment, 'error', message);
      return {
        environment,
        plans: 0,
        items: 0,
        customers: 0,
        subscriptions: 0,
        payments: 0,
        status: 'failed',
        error: message,
      };
    }

    try {
      // ── 1. Sync catalog (plans + items) ──────────────────────────────────────
      const { account, plans, items } = await provider.syncCatalog();

      const client = await this.getPool().connect();
      try {
        await client.query('BEGIN');
        await this.upsertPlansAsProducts(client, environment, plans);
        await this.upsertItemsAsPrices(client, environment, items, plans);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // ── 2. Sync customers ───────────────────────────────────────────────────
      let customers: RazorpayCustomer[] = [];
      try {
        customers = await provider.listCustomers();
        await this.upsertCustomers(environment, customers);
      } catch (err) {
        logger.warn('Razorpay customer sync failed', {
          environment,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // ── 3. Sync subscriptions ──────────────────────────────────────────────
      let subscriptions: RazorpaySubscription[] = [];
      try {
        subscriptions = await provider.listSubscriptions();
        await this.upsertSubscriptions(environment, subscriptions, plans);
      } catch (err) {
        logger.warn('Razorpay subscription sync failed', {
          environment,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // ── 4. Sync payments ───────────────────────────────────────────────────
      let payments: RazorpayPayment[] = [];
      try {
        payments = await provider.listPayments();
        await this.upsertPayments(environment, payments);
      } catch (err) {
        logger.warn('Razorpay payment history sync failed', {
          environment,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // ── 5. Record connection status ────────────────────────────────────────
      const syncCounts = {
        plans: plans.length,
        items: items.length,
        customers: customers.length,
        subscriptions: subscriptions.length,
        payments: payments.length,
      };

      await this.configService.writeSnapshot(
        environment,
        account.id,
        account.merchantName,
        account.livemode,
        syncCounts,
        new Date()
      );

      logger.info('Razorpay sync completed', { environment, syncCounts });

      return {
        environment,
        ...syncCounts,
        status: 'succeeded',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Razorpay sync failed', { environment, error: message });
      await this.configService.recordConnectionStatus(environment, 'error', message);
      return {
        environment,
        plans: 0,
        items: 0,
        customers: 0,
        subscriptions: 0,
        payments: 0,
        status: 'failed',
        error: message,
      };
    }
  }

  // ─── Catalog: Plans → products table ─────────────────────────────────────────

  private async upsertPlansAsProducts(
    client: PoolClient,
    environment: RazorpayEnvironment,
    plans: RazorpayPlan[]
  ): Promise<void> {
    for (const plan of plans) {
      await client.query(
        `INSERT INTO payments.products (
           environment,
           stripe_product_id,
           name,
           description,
           active,
           default_price_id,
           metadata,
           raw,
           synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (environment, stripe_product_id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           active = EXCLUDED.active,
           default_price_id = EXCLUDED.default_price_id,
           metadata = EXCLUDED.metadata,
           raw = EXCLUDED.raw,
           synced_at = NOW(),
           updated_at = NOW()`,
        [
          environment,
          plan.id, // plan_xxxxx stored as stripe_product_id
          plan.item.name,
          plan.item.description ?? null,
          plan.item.active !== false,
          plan.item.id, // item_xxxxx as default_price_id
          plan.notes ?? {},
          plan,
        ]
      );
    }
  }

  // ─── Catalog: Items → prices table ──────────────────────────────────────────

  private async upsertItemsAsPrices(
    client: PoolClient,
    environment: RazorpayEnvironment,
    items: RazorpayItem[],
    plans: RazorpayPlan[]
  ): Promise<void> {
    // Build a map from item.id → plan (so we know the recurring interval)
    const planByItemId = new Map<string, RazorpayPlan>();
    for (const plan of plans) {
      planByItemId.set(plan.item.id, plan);
    }

    for (const item of items) {
      const plan = planByItemId.get(item.id);

      await client.query(
        `INSERT INTO payments.prices (
           environment,
           stripe_price_id,
           stripe_product_id,
           active,
           currency,
           unit_amount,
           unit_amount_decimal,
           type,
           lookup_key,
           billing_scheme,
           tax_behavior,
           recurring_interval,
           recurring_interval_count,
           metadata,
           raw,
           synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
         ON CONFLICT (environment, stripe_price_id) DO UPDATE SET
           stripe_product_id = EXCLUDED.stripe_product_id,
           active = EXCLUDED.active,
           currency = EXCLUDED.currency,
           unit_amount = EXCLUDED.unit_amount,
           unit_amount_decimal = EXCLUDED.unit_amount_decimal,
           type = EXCLUDED.type,
           recurring_interval = EXCLUDED.recurring_interval,
           recurring_interval_count = EXCLUDED.recurring_interval_count,
           metadata = EXCLUDED.metadata,
           raw = EXCLUDED.raw,
           synced_at = NOW(),
           updated_at = NOW()`,
        [
          environment,
          item.id, // item_xxxxx stored as stripe_price_id
          plan?.id ?? null, // plan_xxxxx links to the product
          item.active !== false,
          item.currency.toLowerCase(),
          item.amount, // Razorpay amounts are in paise/cents
          item.amount?.toString() ?? null,
          plan ? 'recurring' : 'one_time',
          null, // no lookup_key in Razorpay
          'per_unit',
          null, // no tax_behavior in Razorpay
          plan?.period ?? null, // 'daily', 'weekly', 'monthly', 'yearly'
          plan?.interval ?? null, // e.g. 1 means every 1 month
          {},
          item,
        ]
      );
    }

    // Also create price entries for plans that have inline items not in the items list
    for (const plan of plans) {
      if (!items.some((item) => item.id === plan.item.id)) {
        await client.query(
          `INSERT INTO payments.prices (
             environment,
             stripe_price_id,
             stripe_product_id,
             active,
             currency,
             unit_amount,
             unit_amount_decimal,
             type,
             lookup_key,
             billing_scheme,
             tax_behavior,
             recurring_interval,
             recurring_interval_count,
             metadata,
             raw,
             synced_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
           ON CONFLICT (environment, stripe_price_id) DO UPDATE SET
             stripe_product_id = EXCLUDED.stripe_product_id,
             active = EXCLUDED.active,
             currency = EXCLUDED.currency,
             unit_amount = EXCLUDED.unit_amount,
             unit_amount_decimal = EXCLUDED.unit_amount_decimal,
             type = EXCLUDED.type,
             recurring_interval = EXCLUDED.recurring_interval,
             recurring_interval_count = EXCLUDED.recurring_interval_count,
             metadata = EXCLUDED.metadata,
             raw = EXCLUDED.raw,
             synced_at = NOW(),
             updated_at = NOW()`,
          [
            environment,
            plan.item.id,
            plan.id,
            plan.item.active !== false,
            plan.item.currency.toLowerCase(),
            plan.item.amount,
            plan.item.amount?.toString() ?? null,
            'recurring',
            null,
            'per_unit',
            null,
            plan.period,
            plan.interval,
            plan.notes ?? {},
            plan.item,
          ]
        );
      }
    }
  }

  // ─── Customers ──────────────────────────────────────────────────────────────

  private async upsertCustomers(
    environment: RazorpayEnvironment,
    customers: RazorpayCustomer[]
  ): Promise<void> {
    const syncedAt = new Date();
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      for (const customer of customers) {
        const createdAt = customer.created_at ? new Date(customer.created_at * 1000) : null;

        await client.query(
          `INSERT INTO payments.customers (
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
           VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, $9)
           ON CONFLICT (environment, stripe_customer_id) DO UPDATE SET
             email = EXCLUDED.email,
             name = EXCLUDED.name,
             phone = EXCLUDED.phone,
             deleted = false,
             metadata = EXCLUDED.metadata,
             raw = EXCLUDED.raw,
             stripe_created_at = EXCLUDED.stripe_created_at,
             synced_at = EXCLUDED.synced_at,
             updated_at = NOW()`,
          [
            environment,
            customer.id, // cust_xxxxx stored as stripe_customer_id
            customer.email ?? null,
            customer.name ?? null,
            customer.contact ?? null,
            customer.notes ?? {},
            customer,
            createdAt,
            syncedAt,
          ]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Subscriptions ──────────────────────────────────────────────────────────

  private async upsertSubscriptions(
    environment: RazorpayEnvironment,
    subscriptions: RazorpaySubscription[],
    plans: RazorpayPlan[]
  ): Promise<void> {
    const client = await this.getPool().connect();
    const planMap = new Map(plans.map((p) => [p.id, p]));

    try {
      await client.query('BEGIN');

      for (const sub of subscriptions) {
        const plan = planMap.get(sub.plan_id);

        // Map Razorpay status to a Stripe-compatible status
        const status = this.mapRazorpaySubscriptionStatus(sub.status);

        await client.query(
          `INSERT INTO payments.subscriptions (
             environment,
             stripe_subscription_id,
             stripe_customer_id,
             status,
             current_period_start,
             current_period_end,
             cancel_at_period_end,
             cancel_at,
             canceled_at,
             latest_invoice_id,
             metadata,
             raw,
             synced_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
           ON CONFLICT (environment, stripe_subscription_id) DO UPDATE SET
             stripe_customer_id = EXCLUDED.stripe_customer_id,
             status = EXCLUDED.status,
             current_period_start = EXCLUDED.current_period_start,
             current_period_end = EXCLUDED.current_period_end,
             cancel_at_period_end = EXCLUDED.cancel_at_period_end,
             cancel_at = EXCLUDED.cancel_at,
             canceled_at = EXCLUDED.canceled_at,
             latest_invoice_id = EXCLUDED.latest_invoice_id,
             metadata = EXCLUDED.metadata,
             raw = EXCLUDED.raw,
             synced_at = NOW(),
             updated_at = NOW()`,
          [
            environment,
            sub.id, // sub_xxxxx
            sub.customer_id ?? null,
            status,
            sub.current_start ? new Date(sub.current_start * 1000) : null,
            sub.current_end ? new Date(sub.current_end * 1000) : null,
            sub.status === 'cancelled' || sub.end_at !== null,
            sub.end_at ? new Date(sub.end_at * 1000) : null,
            sub.ended_at ? new Date(sub.ended_at * 1000) : null,
            null, // latest_invoice_id (not directly in sub)
            sub.notes ?? {},
            sub,
          ]
        );

        // Upsert a subscription_item that links back to the plan (product) and its item (price)
        if (plan) {
          await client.query(
            `INSERT INTO payments.subscription_items (
               environment,
               stripe_subscription_item_id,
               stripe_subscription_id,
               stripe_product_id,
               stripe_price_id,
               quantity,
               metadata,
               raw
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (environment, stripe_subscription_item_id) DO UPDATE SET
               stripe_subscription_id = EXCLUDED.stripe_subscription_id,
               stripe_product_id = EXCLUDED.stripe_product_id,
               stripe_price_id = EXCLUDED.stripe_price_id,
               quantity = EXCLUDED.quantity,
               metadata = EXCLUDED.metadata,
               raw = EXCLUDED.raw,
               updated_at = NOW()`,
            [
              environment,
              `${sub.id}_${plan.id}`, // synthetic subscription item ID
              sub.id,
              plan.id, // plan_xxxxx → product
              plan.item.id, // item_xxxxx → price
              sub.quantity ?? 1,
              sub.notes ?? {},
              sub,
            ]
          );
        }
      }

      // Clean up subscriptions that are no longer in Razorpay
      const syncedIds = subscriptions.map((s) => s.id);
      if (syncedIds.length > 0) {
        await client.query(
          `DELETE FROM payments.subscription_items
           WHERE environment = $1
             AND stripe_subscription_id LIKE 'sub_%'
             AND NOT (stripe_subscription_id = ANY($2::TEXT[]))`,
          [environment, syncedIds]
        );
        await client.query(
          `DELETE FROM payments.subscriptions
           WHERE environment = $1
             AND stripe_subscription_id LIKE 'sub_%'
             AND NOT (stripe_subscription_id = ANY($2::TEXT[]))`,
          [environment, syncedIds]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Payments → payment_history ────────────────────────────────────────────

  private async upsertPayments(
    environment: RazorpayEnvironment,
    payments: RazorpayPayment[]
  ): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      for (const payment of payments) {
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
          `INSERT INTO payments.payment_history (
             environment,
             type,
             status,
             stripe_customer_id,
             customer_email_snapshot,
             stripe_payment_intent_id,
             stripe_invoice_id,
             stripe_charge_id,
             amount,
             amount_refunded,
             currency,
             description,
             paid_at,
             failed_at,
             refunded_at,
             stripe_created_at,
             raw
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT (environment, stripe_payment_intent_id)
             WHERE stripe_payment_intent_id IS NOT NULL
               AND type <> 'refund'
           DO UPDATE SET
             type = EXCLUDED.type,
             status = EXCLUDED.status,
             stripe_customer_id = EXCLUDED.stripe_customer_id,
             customer_email_snapshot = EXCLUDED.customer_email_snapshot,
             stripe_invoice_id = EXCLUDED.stripe_invoice_id,
             stripe_charge_id = EXCLUDED.stripe_charge_id,
             amount = EXCLUDED.amount,
             amount_refunded = EXCLUDED.amount_refunded,
             currency = EXCLUDED.currency,
             description = EXCLUDED.description,
             paid_at = EXCLUDED.paid_at,
             failed_at = EXCLUDED.failed_at,
             refunded_at = EXCLUDED.refunded_at,
             stripe_created_at = EXCLUDED.stripe_created_at,
             raw = EXCLUDED.raw,
             updated_at = NOW()`,
          [
            environment,
            type,
            status,
            payment.customer_id ?? null,
            payment.email ?? null,
            payment.id, // pay_xxxxx stored as stripe_payment_intent_id
            payment.invoice_id ?? null,
            payment.order_id ?? null, // order_xxxxx stored as stripe_charge_id
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

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Status mapping helpers ───────────────────────────────────────────────

  private mapRazorpaySubscriptionStatus(rzpStatus: RazorpaySubscription['status']): string {
    switch (rzpStatus) {
      case 'active':
        return 'active';
      case 'created':
      case 'authenticated':
      case 'pending':
        return 'incomplete';
      case 'halted':
        return 'past_due';
      case 'paused':
        return 'paused';
      case 'cancelled':
        return 'canceled';
      case 'completed':
      case 'expired':
        return 'canceled';
      default:
        return 'incomplete';
    }
  }

  private mapRazorpayPaymentStatus(
    rzpStatus: RazorpayPayment['status']
  ): 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded' {
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
