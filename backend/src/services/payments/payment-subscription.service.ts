import type { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import type { StripeProvider } from '@/providers/payments/stripe.provider.js';
import {
  fromStripeTimestamp,
  getBillingSubjectFromMetadata,
  getStripeObjectId,
  toISOString,
  toISOStringOrNull,
} from '@/services/payments/helpers.js';
import type {
  StripeEnvironment,
  StripeSubscription,
  StripeSubscriptionItem,
  StripeSubscriptionItemRow,
  StripeSubscriptionRow,
} from '@/types/payments.js';
import type {
  BillingSubject,
  ListSubscriptionsRequest,
  ListSubscriptionsResponse,
  SyncPaymentsSubscriptionsSummary,
} from '@insforge/shared-schemas';

export interface SubscriptionProjectionResult {
  synced: boolean;
  unmapped: boolean;
}

export class PaymentSubscriptionService {
  private static instance: PaymentSubscriptionService;
  private pool: Pool | null = null;

  static getInstance(): PaymentSubscriptionService {
    if (!PaymentSubscriptionService.instance) {
      PaymentSubscriptionService.instance = new PaymentSubscriptionService();
    }

    return PaymentSubscriptionService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async listSubscriptions(input: ListSubscriptionsRequest): Promise<ListSubscriptionsResponse> {
    const params: Array<string | number> = [input.environment];
    const filters = ['environment = $1'];

    if (input.subjectType && input.subjectId) {
      params.push(input.subjectType, input.subjectId);
      filters.push(`subject_type = $${params.length - 1}`, `subject_id = $${params.length}`);
    }

    params.push(input.limit);

    const subscriptionsResult = await this.getPool().query(
      `SELECT
         environment,
         stripe_subscription_id AS "stripeSubscriptionId",
         stripe_customer_id AS "stripeCustomerId",
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         status,
         current_period_start AS "currentPeriodStart",
         current_period_end AS "currentPeriodEnd",
         cancel_at_period_end AS "cancelAtPeriodEnd",
         cancel_at AS "cancelAt",
         canceled_at AS "canceledAt",
         trial_start AS "trialStart",
         trial_end AS "trialEnd",
         latest_invoice_id AS "latestInvoiceId",
         metadata,
         synced_at AS "syncedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM payments.subscriptions
       WHERE ${filters.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT $${params.length}`,
      params
    );

    const subscriptionRows = subscriptionsResult.rows as StripeSubscriptionRow[];
    if (subscriptionRows.length === 0) {
      return { subscriptions: [] };
    }

    const subscriptionIds = subscriptionRows.map((row) => row.stripeSubscriptionId);
    const itemsResult = await this.getPool().query(
      `SELECT
         environment,
         stripe_subscription_item_id AS "stripeSubscriptionItemId",
         stripe_subscription_id AS "stripeSubscriptionId",
         stripe_product_id AS "stripeProductId",
         stripe_price_id AS "stripePriceId",
         quantity,
         metadata,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM payments.subscription_items
       WHERE environment = $1
         AND stripe_subscription_id = ANY($2::TEXT[])
       ORDER BY stripe_subscription_id, stripe_subscription_item_id`,
      [input.environment, subscriptionIds]
    );

    const itemsBySubscriptionId = new Map<string, StripeSubscriptionItemRow[]>();
    for (const item of itemsResult.rows as StripeSubscriptionItemRow[]) {
      const items = itemsBySubscriptionId.get(item.stripeSubscriptionId) ?? [];
      items.push(item);
      itemsBySubscriptionId.set(item.stripeSubscriptionId, items);
    }

    return {
      subscriptions: subscriptionRows.map((row) => ({
        ...this.normalizeSubscriptionRow(row),
        items: (itemsBySubscriptionId.get(row.stripeSubscriptionId) ?? []).map((item) =>
          this.normalizeSubscriptionItemRow(item)
        ),
      })),
    };
  }

  async syncSubscriptionsWithProvider(
    environment: StripeEnvironment,
    provider: StripeProvider
  ): Promise<SyncPaymentsSubscriptionsSummary> {
    const subscriptions = await provider.listSubscriptions();
    let synced = 0;
    let unmapped = 0;

    for (const subscription of subscriptions) {
      const result = await this.upsertSubscriptionProjection(environment, subscription, provider);
      if (result.synced) {
        synced += 1;
      }
      if (result.unmapped) {
        unmapped += 1;
      }
    }

    const deleted = await this.deleteMissingSyncedSubscriptions(
      environment,
      subscriptions.map((subscription) => subscription.id)
    );

    return {
      environment,
      synced,
      unmapped,
      deleted,
    };
  }

  async upsertSubscriptionProjection(
    environment: StripeEnvironment,
    subscription: StripeSubscription,
    provider?: StripeProvider
  ): Promise<SubscriptionProjectionResult> {
    const stripeCustomerId = getStripeObjectId(subscription.customer);
    if (!stripeCustomerId) {
      return { synced: false, unmapped: false };
    }

    const subject = await this.resolveSubscriptionSubject(
      environment,
      subscription,
      stripeCustomerId
    );

    const subscriptionItems = await this.resolveSubscriptionItems(subscription, provider);
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO payments.subscriptions (
           environment,
           stripe_subscription_id,
           stripe_customer_id,
           subject_type,
           subject_id,
           status,
           current_period_start,
           current_period_end,
           cancel_at_period_end,
           cancel_at,
           canceled_at,
           trial_start,
           trial_end,
           latest_invoice_id,
           metadata,
           raw,
           synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
         ON CONFLICT (environment, stripe_subscription_id) DO UPDATE SET
           stripe_customer_id = EXCLUDED.stripe_customer_id,
           subject_type = EXCLUDED.subject_type,
           subject_id = EXCLUDED.subject_id,
           status = EXCLUDED.status,
           current_period_start = EXCLUDED.current_period_start,
           current_period_end = EXCLUDED.current_period_end,
           cancel_at_period_end = EXCLUDED.cancel_at_period_end,
           cancel_at = EXCLUDED.cancel_at,
           canceled_at = EXCLUDED.canceled_at,
           trial_start = EXCLUDED.trial_start,
           trial_end = EXCLUDED.trial_end,
           latest_invoice_id = EXCLUDED.latest_invoice_id,
           metadata = EXCLUDED.metadata,
           raw = EXCLUDED.raw,
           synced_at = NOW(),
           updated_at = NOW()`,
        [
          environment,
          subscription.id,
          stripeCustomerId,
          subject?.type ?? null,
          subject?.id ?? null,
          subscription.status,
          fromStripeTimestamp(this.getSubscriptionCurrentPeriodStart(subscriptionItems)),
          fromStripeTimestamp(this.getSubscriptionCurrentPeriodEnd(subscriptionItems)),
          subscription.cancel_at_period_end,
          fromStripeTimestamp(subscription.cancel_at),
          fromStripeTimestamp(subscription.canceled_at),
          fromStripeTimestamp(subscription.trial_start),
          fromStripeTimestamp(subscription.trial_end),
          getStripeObjectId(subscription.latest_invoice),
          subscription.metadata ?? {},
          subscription,
        ]
      );

      for (const item of subscriptionItems) {
        await this.upsertSubscriptionItem(client, environment, subscription.id, item);
      }

      await client.query(
        `DELETE FROM payments.subscription_items
         WHERE environment = $1
           AND stripe_subscription_id = $2
           AND NOT (stripe_subscription_item_id = ANY($3::TEXT[]))`,
        [
          environment,
          subscription.id,
          subscriptionItems.map((item: StripeSubscriptionItem) => item.id),
        ]
      );

      await client.query('COMMIT');
      return { synced: true, unmapped: !subject };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async deleteMissingSyncedSubscriptions(
    environment: StripeEnvironment,
    stripeSubscriptionIds: string[]
  ): Promise<number> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM payments.subscription_items
         WHERE environment = $1
           AND NOT (stripe_subscription_id = ANY($2::TEXT[]))`,
        [environment, stripeSubscriptionIds]
      );
      const result = await client.query(
        `DELETE FROM payments.subscriptions
         WHERE environment = $1
           AND NOT (stripe_subscription_id = ANY($2::TEXT[]))`,
        [environment, stripeSubscriptionIds]
      );
      await client.query('COMMIT');
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertSubscriptionItem(
    client: PoolClient,
    environment: StripeEnvironment,
    stripeSubscriptionId: string,
    item: StripeSubscriptionItem
  ): Promise<void> {
    const price = item.price;

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
        item.id,
        stripeSubscriptionId,
        getStripeObjectId(price?.product),
        getStripeObjectId(price),
        item.quantity ?? null,
        item.metadata ?? {},
        item,
      ]
    );
  }

  private async resolveSubscriptionItems(
    subscription: StripeSubscription,
    provider?: StripeProvider
  ): Promise<StripeSubscriptionItem[]> {
    const embeddedItems = subscription.items?.data ?? [];
    if (!provider || subscription.items?.has_more !== true) {
      return embeddedItems;
    }

    return provider.listSubscriptionItems(subscription.id);
  }

  private async resolveSubscriptionSubject(
    environment: StripeEnvironment,
    subscription: StripeSubscription,
    stripeCustomerId: string
  ): Promise<BillingSubject | null> {
    return (
      getBillingSubjectFromMetadata(subscription.metadata) ??
      (await this.resolveSubjectFromCustomerMapping(environment, stripeCustomerId))
    );
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

  private async resolveSubjectFromCustomerMapping(
    environment: StripeEnvironment,
    stripeCustomerId: string | null
  ): Promise<BillingSubject | null> {
    if (!stripeCustomerId) {
      return null;
    }

    const mapping = await this.findStripeCustomerMappingByCustomerId(environment, stripeCustomerId);
    if (!mapping) {
      return null;
    }

    return { type: mapping.subjectType, id: mapping.subjectId };
  }

  private normalizeSubscriptionRow(
    row: StripeSubscriptionRow
  ): Omit<ListSubscriptionsResponse['subscriptions'][number], 'items'> {
    return {
      environment: row.environment,
      stripeSubscriptionId: row.stripeSubscriptionId,
      stripeCustomerId: row.stripeCustomerId,
      subjectType: row.subjectType ?? null,
      subjectId: row.subjectId ?? null,
      status: row.status,
      currentPeriodStart: toISOStringOrNull(row.currentPeriodStart),
      currentPeriodEnd: toISOStringOrNull(row.currentPeriodEnd),
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      cancelAt: toISOStringOrNull(row.cancelAt),
      canceledAt: toISOStringOrNull(row.canceledAt),
      trialStart: toISOStringOrNull(row.trialStart),
      trialEnd: toISOStringOrNull(row.trialEnd),
      latestInvoiceId: row.latestInvoiceId ?? null,
      metadata: row.metadata ?? {},
      syncedAt: toISOString(row.syncedAt),
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  private normalizeSubscriptionItemRow(
    row: StripeSubscriptionItemRow
  ): NonNullable<ListSubscriptionsResponse['subscriptions'][number]['items']>[number] {
    return {
      environment: row.environment,
      stripeSubscriptionItemId: row.stripeSubscriptionItemId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      stripeProductId: row.stripeProductId ?? null,
      stripePriceId: row.stripePriceId ?? null,
      quantity: row.quantity === null ? null : Number(row.quantity),
      metadata: row.metadata ?? {},
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  private getSubscriptionCurrentPeriodStart(items: StripeSubscriptionItem[]): number | null {
    const starts = items
      .map((item) => item.current_period_start)
      .filter((value): value is number => typeof value === 'number');

    return starts.length > 0 ? Math.min(...starts) : null;
  }

  private getSubscriptionCurrentPeriodEnd(items: StripeSubscriptionItem[]): number | null {
    const ends = items
      .map((item) => item.current_period_end)
      .filter((value): value is number => typeof value === 'number');

    return ends.length > 0 ? Math.max(...ends) : null;
  }
}
