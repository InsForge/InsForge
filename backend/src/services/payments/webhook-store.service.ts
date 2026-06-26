import type { Pool } from 'pg';
import { AppError } from '@/utils/errors.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import type { PaymentEnvironment, PaymentProvider } from '@/types/payments.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

/**
 * How long a row may sit in `pending` before another delivery of the same event
 * is allowed to reclaim and retry it. Guards against a crashed handler wedging
 * an event as permanently pending.
 */
const WEBHOOK_PENDING_RECLAIM_WINDOW_MS = 5 * 60 * 1000;

export type PaymentWebhookProcessingStatus = 'pending' | 'processed' | 'failed' | 'ignored';

/**
 * A row from `payments.webhook_events`. The table is provider-scoped, so this is
 * the superset of columns both Stripe and Razorpay use; columns a given provider
 * doesn't populate (e.g. Razorpay leaves `accountId`/`objectType`/`objectId`
 * null) come back null.
 */
export interface PaymentWebhookEventRow {
  id: string;
  environment: PaymentEnvironment;
  provider: PaymentProvider;
  eventId: string;
  eventType: string;
  livemode: boolean;
  accountId: string | null;
  objectType: string | null;
  objectId: string | null;
  processingStatus: PaymentWebhookProcessingStatus;
  attemptCount: number;
  lastError: string | null;
  receivedAt: Date | string;
  processedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface RecordWebhookEventInput {
  provider: PaymentProvider;
  environment: PaymentEnvironment;
  eventId: string;
  eventType: string;
  livemode: boolean;
  /** Full provider event/payload, stored verbatim in the `payload` jsonb column. */
  payload: unknown;
  /** Stripe-only; left null for providers that don't record them. */
  accountId?: string | null;
  objectType?: string | null;
  objectId?: string | null;
}

export interface RecordWebhookEventResult {
  row: PaymentWebhookEventRow;
  shouldProcess: boolean;
}

const RETURNING_COLUMNS = `
  id,
  environment,
  provider,
  provider_event_id    AS "eventId",
  event_type           AS "eventType",
  livemode,
  provider_account_id  AS "accountId",
  object_type          AS "objectType",
  object_id            AS "objectId",
  processing_status    AS "processingStatus",
  attempt_count        AS "attemptCount",
  last_error           AS "lastError",
  received_at          AS "receivedAt",
  processed_at         AS "processedAt",
  created_at           AS "createdAt",
  updated_at           AS "updatedAt"`;

/**
 * Shared idempotent store for inbound payment webhook events. Owns the
 * `payments.webhook_events` lifecycle (record-with-idempotency, retry reclaim,
 * status marking) that Stripe and Razorpay previously duplicated. Provider
 * specifics — signature verification, event-id derivation, and event-type
 * dispatch — stay in each provider's webhook service.
 */
export class WebhookStoreService {
  private static instance: WebhookStoreService;
  private pool: Pool | null = null;

  static getInstance(): WebhookStoreService {
    if (!WebhookStoreService.instance) {
      WebhookStoreService.instance = new WebhookStoreService();
    }
    return WebhookStoreService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Record the arrival of an event and decide whether it should be processed.
   * Returns `shouldProcess: false` when the event is a duplicate that's already
   * been processed (or is being processed within the reclaim window).
   *
   * Three steps, all keyed on `(provider, environment, provider_event_id)`:
   *   1. INSERT … ON CONFLICT DO NOTHING — wins for a brand-new event.
   *   2. UPDATE … WHERE failed OR stale-pending — reclaims for a retry.
   *   3. SELECT — the event is already terminal/in-flight, so skip it.
   */
  async recordStart(input: RecordWebhookEventInput): Promise<RecordWebhookEventResult> {
    const pool = this.getPool();
    const pendingReclaimCutoff = new Date(Date.now() - WEBHOOK_PENDING_RECLAIM_WINDOW_MS);
    const { provider, environment, eventId, eventType, livemode, payload } = input;
    const accountId = input.accountId ?? null;
    const objectType = input.objectType ?? null;
    const objectId = input.objectId ?? null;

    const insertResult = await pool.query<PaymentWebhookEventRow>(
      `INSERT INTO payments.webhook_events (
         provider,
         environment,
         provider_event_id,
         event_type,
         livemode,
         provider_account_id,
         object_type,
         object_id,
         processing_status,
         attempt_count,
         payload
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 1, $9)
       ON CONFLICT (provider, environment, provider_event_id) DO NOTHING
       RETURNING ${RETURNING_COLUMNS}`,
      [
        provider,
        environment,
        eventId,
        eventType,
        livemode,
        accountId,
        objectType,
        objectId,
        payload,
      ]
    );

    const inserted = insertResult.rows[0];
    if (inserted) {
      return { row: inserted, shouldProcess: true };
    }

    const retryResult = await pool.query<PaymentWebhookEventRow>(
      `UPDATE payments.webhook_events
       SET processing_status = 'pending',
           attempt_count = attempt_count + 1,
           last_error = NULL,
           processed_at = NULL,
           payload = $4,
           updated_at = NOW()
       WHERE provider = $1
         AND environment = $2
         AND provider_event_id = $3
         AND (
           processing_status = 'failed'
           OR (processing_status = 'pending' AND updated_at < $5)
         )
       RETURNING ${RETURNING_COLUMNS}`,
      [provider, environment, eventId, payload, pendingReclaimCutoff]
    );

    const retried = retryResult.rows[0];
    if (retried) {
      return { row: retried, shouldProcess: true };
    }

    const existingResult = await pool.query<PaymentWebhookEventRow>(
      `SELECT ${RETURNING_COLUMNS}
       FROM payments.webhook_events
       WHERE provider = $1
         AND environment = $2
         AND provider_event_id = $3`,
      [provider, environment, eventId]
    );

    const existing = existingResult.rows[0];
    if (!existing) {
      // The conflicting row that blocked the INSERT/reclaim should still be
      // here; if it isn't, it was deleted concurrently and we can't proceed.
      throw new AppError(
        `Webhook event ${provider}/${environment}/${eventId} vanished during recording`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    return { row: existing, shouldProcess: false };
  }

  /** Transition an event to a terminal status, stamping `processed_at` on success. */
  async mark(
    provider: PaymentProvider,
    environment: PaymentEnvironment,
    eventId: string,
    status: PaymentWebhookProcessingStatus,
    error: string | null
  ): Promise<PaymentWebhookEventRow> {
    const result = await this.getPool().query<PaymentWebhookEventRow>(
      `UPDATE payments.webhook_events
       SET processing_status = $4,
           last_error = $5,
           processed_at = CASE WHEN $4 IN ('processed', 'ignored') THEN NOW() ELSE processed_at END,
           updated_at = NOW()
       WHERE provider = $1
         AND environment = $2
         AND provider_event_id = $3
       RETURNING ${RETURNING_COLUMNS}`,
      [provider, environment, eventId, status, error]
    );

    const row = result.rows[0];
    if (!row) {
      // The event is marked only after it was recorded, so the row must exist;
      // a no-op UPDATE means it was deleted out from under us.
      throw new AppError(
        `Webhook event ${provider}/${environment}/${eventId} not found while marking ${status}`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    return row;
  }
}
