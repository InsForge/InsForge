import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { getStripeObjectId, toISOString, toISOStringOrNull } from '@/services/payments/helpers.js';
import type { StripeEnvironment, StripeEvent, StripeWebhookEventRow } from '@/types/payments.js';
import type { StripeWebhookEvent } from '@insforge/shared-schemas';

const WEBHOOK_PENDING_RECLAIM_WINDOW_MS = 5 * 60 * 1000;

export class PaymentWebhookService {
  private static instance: PaymentWebhookService;
  private pool: Pool | null = null;

  static getInstance(): PaymentWebhookService {
    if (!PaymentWebhookService.instance) {
      PaymentWebhookService.instance = new PaymentWebhookService();
    }

    return PaymentWebhookService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async recordWebhookEventStart(
    environment: StripeEnvironment,
    event: StripeEvent
  ): Promise<{ row: StripeWebhookEventRow; shouldProcess: boolean }> {
    const object = event.data.object as unknown;
    const objectType = this.getStripeObjectType(object);
    const objectId = getStripeObjectId(object);
    const stripeAccountId = typeof event.account === 'string' ? event.account : null;
    const pendingReclaimCutoff = new Date(Date.now() - WEBHOOK_PENDING_RECLAIM_WINDOW_MS);

    const insertResult = await this.getPool().query(
      `INSERT INTO payments.webhook_events (
         environment,
         stripe_event_id,
         event_type,
         livemode,
         stripe_account_id,
         object_type,
         object_id,
         processing_status,
         attempt_count,
         payload
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 1, $8)
       ON CONFLICT (environment, stripe_event_id) DO NOTHING
       RETURNING
         environment,
         stripe_event_id AS "stripeEventId",
         event_type AS "eventType",
         livemode,
         stripe_account_id AS "stripeAccountId",
         object_type AS "objectType",
         object_id AS "objectId",
         processing_status AS "processingStatus",
         attempt_count AS "attemptCount",
         last_error AS "lastError",
         received_at AS "receivedAt",
         processed_at AS "processedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [
        environment,
        event.id,
        event.type,
        event.livemode,
        stripeAccountId,
        objectType,
        objectId,
        event,
      ]
    );

    const inserted = insertResult.rows[0] as StripeWebhookEventRow | undefined;
    if (inserted) {
      return { row: inserted, shouldProcess: true };
    }

    const retryResult = await this.getPool().query(
      `UPDATE payments.webhook_events
       SET processing_status = 'pending',
           attempt_count = attempt_count + 1,
           last_error = NULL,
           processed_at = NULL,
           payload = $3,
           updated_at = NOW()
       WHERE environment = $1
         AND stripe_event_id = $2
         AND (
           processing_status = 'failed'
           OR (processing_status = 'pending' AND updated_at < $4)
         )
       RETURNING
         environment,
         stripe_event_id AS "stripeEventId",
         event_type AS "eventType",
         livemode,
         stripe_account_id AS "stripeAccountId",
         object_type AS "objectType",
         object_id AS "objectId",
         processing_status AS "processingStatus",
         attempt_count AS "attemptCount",
         last_error AS "lastError",
         received_at AS "receivedAt",
         processed_at AS "processedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [environment, event.id, event, pendingReclaimCutoff]
    );

    const retried = retryResult.rows[0] as StripeWebhookEventRow | undefined;
    if (retried) {
      return { row: retried, shouldProcess: true };
    }

    const existingResult = await this.getPool().query(
      `SELECT
         environment,
         stripe_event_id AS "stripeEventId",
         event_type AS "eventType",
         livemode,
         stripe_account_id AS "stripeAccountId",
         object_type AS "objectType",
         object_id AS "objectId",
         processing_status AS "processingStatus",
         attempt_count AS "attemptCount",
         last_error AS "lastError",
         received_at AS "receivedAt",
         processed_at AS "processedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM payments.webhook_events
       WHERE environment = $1
         AND stripe_event_id = $2`,
      [environment, event.id]
    );

    return {
      row: existingResult.rows[0] as StripeWebhookEventRow,
      shouldProcess: false,
    };
  }

  async markWebhookEvent(
    environment: StripeEnvironment,
    stripeEventId: string,
    processingStatus: 'processed' | 'failed' | 'ignored',
    error: string | null
  ): Promise<StripeWebhookEventRow> {
    const result = await this.getPool().query(
      `UPDATE payments.webhook_events
       SET processing_status = $3,
           last_error = $4,
           processed_at = CASE WHEN $3 IN ('processed', 'ignored') THEN NOW() ELSE processed_at END,
           updated_at = NOW()
       WHERE environment = $1
         AND stripe_event_id = $2
       RETURNING
         environment,
         stripe_event_id AS "stripeEventId",
         event_type AS "eventType",
         livemode,
         stripe_account_id AS "stripeAccountId",
         object_type AS "objectType",
         object_id AS "objectId",
         processing_status AS "processingStatus",
         attempt_count AS "attemptCount",
         last_error AS "lastError",
         received_at AS "receivedAt",
         processed_at AS "processedAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [environment, stripeEventId, processingStatus, error]
    );

    return result.rows[0] as StripeWebhookEventRow;
  }

  normalizeWebhookEventRow(row: StripeWebhookEventRow): StripeWebhookEvent {
    return {
      environment: row.environment,
      stripeEventId: row.stripeEventId,
      eventType: row.eventType,
      livemode: row.livemode,
      stripeAccountId: row.stripeAccountId ?? null,
      objectType: row.objectType ?? null,
      objectId: row.objectId ?? null,
      processingStatus: row.processingStatus,
      attemptCount: Number(row.attemptCount),
      lastError: row.lastError ?? null,
      receivedAt: toISOString(row.receivedAt),
      processedAt: toISOStringOrNull(row.processedAt),
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  private getStripeObjectType(value: unknown): string | null {
    if (
      value &&
      typeof value === 'object' &&
      'object' in value &&
      typeof value.object === 'string'
    ) {
      return value.object;
    }

    return null;
  }
}
