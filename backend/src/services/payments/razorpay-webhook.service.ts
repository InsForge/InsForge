import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import type { RazorpayEnvironment } from '@/types/payments.js';
import type { RazorpayWebhookPayload } from '@/providers/payments/razorpay.provider.js';

export type RazorpayWebhookProcessingStatus = 'pending' | 'processed' | 'failed' | 'ignored';

export interface RazorpayWebhookEventRow {
  id: string;
  environment: RazorpayEnvironment;
  eventId: string;
  eventType: string;
  processingStatus: RazorpayWebhookProcessingStatus;
  attemptCount: number;
  lastError: string | null;
  receivedAt: string;
  processedAt: string | null;
}

interface ShouldProcessResult {
  shouldProcess: boolean;
  row: RazorpayWebhookEventRow;
}

export class RazorpayWebhookService {
  private static instance: RazorpayWebhookService;
  private pool: Pool | null = null;

  static getInstance(): RazorpayWebhookService {
    if (!RazorpayWebhookService.instance) {
      RazorpayWebhookService.instance = new RazorpayWebhookService();
    }
    return RazorpayWebhookService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Record the start of a webhook event. Returns whether it should be processed
   * (i.e. it's not a duplicate already successfully processed).
   */
  async recordWebhookEventStart(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload
  ): Promise<ShouldProcessResult> {
    // Razorpay uses <account_id>.<event>.<created_at> as a pseudo-idempotency key
    // since it does not send a stable event ID in the OSS API.
    const eventId = `${payload.account_id}.${payload.event}.${payload.created_at}`;

    const pendingReclaimCutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes

    const insertResult = await this.getPool().query<RazorpayWebhookEventRow>(
      `INSERT INTO payments.razorpay_webhook_events
         (environment, event_id, event_type, processing_status, attempt_count, received_at)
       VALUES ($1, $2, $3, 'pending', 1, NOW())
       ON CONFLICT (environment, event_id) DO NOTHING
       RETURNING
         id,
         environment,
         event_id           AS "eventId",
         event_type         AS "eventType",
         processing_status  AS "processingStatus",
         attempt_count      AS "attemptCount",
         last_error         AS "lastError",
         received_at        AS "receivedAt",
         processed_at       AS "processedAt"`,
      [environment, eventId, payload.event]
    );

    const inserted = insertResult.rows[0];
    if (inserted) {
      return { row: inserted, shouldProcess: true };
    }

    const retryResult = await this.getPool().query<RazorpayWebhookEventRow>(
      `UPDATE payments.razorpay_webhook_events
       SET processing_status = 'pending',
           attempt_count = attempt_count + 1,
           last_error = NULL,
           processed_at = NULL,
           updated_at = NOW()
       WHERE environment = $1
         AND event_id = $2
         AND (
           processing_status = 'failed'
           OR (processing_status = 'pending' AND updated_at < $3)
         )
       RETURNING
         id,
         environment,
         event_id           AS "eventId",
         event_type         AS "eventType",
         processing_status  AS "processingStatus",
         attempt_count      AS "attemptCount",
         last_error         AS "lastError",
         received_at        AS "receivedAt",
         processed_at       AS "processedAt"`,
      [environment, eventId, pendingReclaimCutoff]
    );

    const retried = retryResult.rows[0];
    if (retried) {
      return { row: retried, shouldProcess: true };
    }

    const existingResult = await this.getPool().query<RazorpayWebhookEventRow>(
      `SELECT
         id,
         environment,
         event_id           AS "eventId",
         event_type         AS "eventType",
         processing_status  AS "processingStatus",
         attempt_count      AS "attemptCount",
         last_error         AS "lastError",
         received_at        AS "receivedAt",
         processed_at       AS "processedAt"
       FROM payments.razorpay_webhook_events
       WHERE environment = $1 AND event_id = $2`,
      [environment, eventId]
    );

    const row = existingResult.rows[0] as RazorpayWebhookEventRow;
    logger.info('Razorpay webhook event already processed or currently processing — skipping', {
      environment,
      eventId,
      eventType: payload.event,
    });

    return { shouldProcess: false, row };
  }

  async markWebhookEvent(
    environment: RazorpayEnvironment,
    eventId: string,
    status: RazorpayWebhookProcessingStatus,
    error: string | null
  ): Promise<RazorpayWebhookEventRow> {
    const result = await this.getPool().query<RazorpayWebhookEventRow>(
      `UPDATE payments.razorpay_webhook_events
       SET processing_status = $3,
           last_error        = $4,
           processed_at      = CASE WHEN $3 IN ('processed', 'ignored') THEN NOW() ELSE processed_at END,
           updated_at        = NOW()
       WHERE environment = $1 AND event_id = $2
       RETURNING
         id,
         environment,
         event_id           AS "eventId",
         event_type         AS "eventType",
         processing_status  AS "processingStatus",
         attempt_count      AS "attemptCount",
         last_error         AS "lastError",
         received_at        AS "receivedAt",
         processed_at       AS "processedAt"`,
      [environment, eventId, status, error]
    );

    return result.rows[0] as RazorpayWebhookEventRow;
  }
}
