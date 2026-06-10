import type { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import type { StripeProvider } from '@/providers/payments/stripe.provider.js';
import {
  fromStripeTimestamp,
  getBillingSubjectFromProviderAttributes,
  getStripeObjectId,
} from '@/services/payments/helpers.js';
import { toISOString, toISOStringOrNull } from '@/utils/dates.js';
import type {
  StripeEnvironment,
  StripeSubscriptionItemRow,
  StripeSubscriptionRow,
  StripeSubscription,
  StripeSubscriptionItem,
} from '@/types/payments.js';
import type {
  BillingSubject,
  ListStripeSubscriptionsRequest,
  ListStripeSubscriptionsResponse,
  SyncStripePaymentsSubscriptionsSummary,
} from '@insforge/shared-schemas';

export interface SubscriptionProjectionResult {
  synced: boolean;
  unmapped: boolean;
}

export class StripeSubscriptionService {
  private static instance: StripeSubscriptionService;
  private pool: Pool | null = null;

  static getInstance(): StripeSubscriptionService {
    if (!StripeSubscriptionService.instance) {
      StripeSubscriptionService.instance = new StripeSubscriptionService();
    }

    return StripeSubscriptionService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async listSubscriptions(
    input: ListStripeSubscriptionsRequest
  ): Promise<ListStripeSubscriptionsResponse> {
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
         subscription_id AS "subscriptionId",
         customer_id AS "customerId",
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
       FROM payments.stripe_subscriptions
       WHERE ${filters.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT $${params.length}`,
      params
    );

    const subscriptionRows = subscriptionsResult.rows as StripeSubscriptionRow[];
    if (subscriptionRows.length === 0) {
      return { subscriptions: [] };
    }

    const subscriptionIds = subscriptionRows.map((row) => row.subscriptionId);
    const itemsResult = await this.getPool().query(
      `SELECT
         items.environment,
         items.subscription_item_id AS "subscriptionItemId",
         items.subscription_id AS "subscriptionId",
         items.product_id AS "productId",
         items.price_id AS "priceId",
         items.quantity,
         items.metadata,
         items.created_at AS "createdAt",
         items.updated_at AS "updatedAt"
       FROM payments.stripe_subscription_items AS items
       JOIN unnest($2::TEXT[]) AS selected(subscription_id)
         ON selected.subscription_id = items.subscription_id
       WHERE items.environment = $1
       ORDER BY items.subscription_id, items.subscription_item_id`,
      [input.environment, subscriptionIds]
    );

    const itemsBySubscriptionId = new Map<string, StripeSubscriptionItemRow[]>();
    for (const item of itemsResult.rows as StripeSubscriptionItemRow[]) {
      const key = item.subscriptionId;
      const items = itemsBySubscriptionId.get(key) ?? [];
      items.push(item);
      itemsBySubscriptionId.set(key, items);
    }

    return {
      subscriptions: subscriptionRows.map((row) => ({
        ...this.normalizeSubscriptionRow(row),
        items: (itemsBySubscriptionId.get(row.subscriptionId) ?? []).map((item) =>
          this.normalizeSubscriptionItemRow(item)
        ),
      })),
    };
  }

  async syncSubscriptionsWithProvider(
    environment: StripeEnvironment,
    provider: StripeProvider
  ): Promise<SyncStripePaymentsSubscriptionsSummary> {
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
    const customerId = getStripeObjectId(subscription.customer);
    if (!customerId) {
      return { synced: false, unmapped: false };
    }

    const subject = await this.resolveSubscriptionSubject(environment, subscription, customerId);

    const subscriptionItems = await this.resolveSubscriptionItems(subscription, provider);
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO payments.stripe_subscriptions (
           environment,
           subscription_id,
           customer_id,
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
         ON CONFLICT (environment, subscription_id) DO UPDATE SET
           customer_id = EXCLUDED.customer_id,
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
          customerId,
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
        `DELETE FROM payments.stripe_subscription_items
         WHERE environment = $1
           AND subscription_id = $2
           AND NOT (subscription_item_id = ANY($3::TEXT[]))`,
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
    subscriptionIds: string[]
  ): Promise<number> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM payments.stripe_subscription_items
         WHERE environment = $1
           AND raw->>'object' = 'subscription_item'
           AND NOT (subscription_id = ANY($2::TEXT[]))`,
        [environment, subscriptionIds]
      );
      const result = await client.query(
        `DELETE FROM payments.stripe_subscriptions
         WHERE environment = $1
           AND raw->>'object' = 'subscription'
           AND NOT (subscription_id = ANY($2::TEXT[]))`,
        [environment, subscriptionIds]
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
    subscriptionId: string,
    item: StripeSubscriptionItem
  ): Promise<void> {
    const price = item.price;

    await client.query(
      `INSERT INTO payments.stripe_subscription_items (
         environment,
         subscription_item_id,
         subscription_id,
         product_id,
         price_id,
         quantity,
         metadata,
         raw
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (environment, subscription_item_id) DO UPDATE SET
         subscription_id = EXCLUDED.subscription_id,
         product_id = EXCLUDED.product_id,
         price_id = EXCLUDED.price_id,
         quantity = EXCLUDED.quantity,
         metadata = EXCLUDED.metadata,
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        environment,
        item.id,
        subscriptionId,
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
    customerId: string
  ): Promise<BillingSubject | null> {
    return (
      getBillingSubjectFromProviderAttributes(subscription.metadata) ??
      (await this.resolveSubjectFromCustomerMapping(environment, customerId))
    );
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

  private async resolveSubjectFromCustomerMapping(
    environment: StripeEnvironment,
    customerId: string | null
  ): Promise<BillingSubject | null> {
    if (!customerId) {
      return null;
    }

    const mapping = await this.findStripeCustomerMappingByCustomerId(environment, customerId);
    if (!mapping) {
      return null;
    }

    return { type: mapping.subjectType, id: mapping.subjectId };
  }

  private normalizeSubscriptionRow(
    row: StripeSubscriptionRow
  ): Omit<ListStripeSubscriptionsResponse['subscriptions'][number], 'items'> {
    return {
      environment: row.environment,
      subscriptionId: row.subscriptionId,
      customerId: row.customerId,
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
  ): NonNullable<ListStripeSubscriptionsResponse['subscriptions'][number]['items']>[number] {
    return {
      environment: row.environment,
      subscriptionItemId: row.subscriptionItemId,
      subscriptionId: row.subscriptionId,
      productId: row.productId ?? null,
      priceId: row.priceId ?? null,
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
