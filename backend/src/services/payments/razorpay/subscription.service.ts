import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { toISOString, toISOStringOrNull } from '@/utils/dates.js';
import type { RazorpaySubscriptionRow } from '@/types/payments.js';
import type {
  ListRazorpaySubscriptionsRequest,
  ListRazorpaySubscriptionsResponse,
} from '@insforge/shared-schemas';

export class RazorpaySubscriptionService {
  private static instance: RazorpaySubscriptionService;
  private pool: Pool | null = null;

  static getInstance(): RazorpaySubscriptionService {
    if (!RazorpaySubscriptionService.instance) {
      RazorpaySubscriptionService.instance = new RazorpaySubscriptionService();
    }

    return RazorpaySubscriptionService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async listSubscriptions(
    input: ListRazorpaySubscriptionsRequest
  ): Promise<ListRazorpaySubscriptionsResponse> {
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
         subscription_id AS "subscriptionId",
         plan_id AS "planId",
         customer_id AS "customerId",
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         status,
         current_start AS "currentStart",
         current_end AS "currentEnd",
         ended_at AS "endedAt",
         quantity,
         charge_at AS "chargeAt",
         start_at AS "startAt",
         end_at AS "endAt",
         total_count AS "totalCount",
         paid_count AS "paidCount",
         remaining_count AS "remainingCount",
         short_url AS "shortUrl",
         has_scheduled_changes AS "hasScheduledChanges",
         change_scheduled_at AS "changeScheduledAt",
         offer_id AS "offerId",
         metadata,
         provider_created_at AS "providerCreatedAt",
         synced_at AS "syncedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM payments.razorpay_subscriptions
       WHERE ${filters.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT $${params.length}`,
      params
    );

    return {
      subscriptions: (result.rows as RazorpaySubscriptionRow[]).map((row) =>
        this.normalizeSubscriptionRow(row)
      ),
    };
  }

  private normalizeSubscriptionRow(
    row: RazorpaySubscriptionRow
  ): ListRazorpaySubscriptionsResponse['subscriptions'][number] {
    return {
      environment: row.environment,
      subscriptionId: row.subscriptionId,
      planId: row.planId,
      customerId: row.customerId,
      subjectType: row.subjectType ?? null,
      subjectId: row.subjectId ?? null,
      status: row.status,
      currentStart: toISOStringOrNull(row.currentStart),
      currentEnd: toISOStringOrNull(row.currentEnd),
      endedAt: toISOStringOrNull(row.endedAt),
      quantity: row.quantity === null ? null : Number(row.quantity),
      chargeAt: toISOStringOrNull(row.chargeAt),
      startAt: toISOStringOrNull(row.startAt),
      endAt: toISOStringOrNull(row.endAt),
      totalCount: row.totalCount === null ? null : Number(row.totalCount),
      paidCount: row.paidCount === null ? null : Number(row.paidCount),
      remainingCount: row.remainingCount === null ? null : Number(row.remainingCount),
      shortUrl: row.shortUrl ?? null,
      hasScheduledChanges: row.hasScheduledChanges,
      changeScheduledAt: toISOStringOrNull(row.changeScheduledAt),
      offerId: row.offerId ?? null,
      metadata: row.metadata ?? {},
      providerCreatedAt: toISOStringOrNull(row.providerCreatedAt),
      syncedAt: toISOString(row.syncedAt),
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }
}
