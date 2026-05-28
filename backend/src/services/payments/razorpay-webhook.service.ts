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

    const result = await this.getPool().query<RazorpayWebhookEventRow>(
      `INSERT INTO payments.razorpay_webhook_events
         (environment, event_id, event_type, processing_status, attempt_count, received_at)
       VALUES ($1, $2, $3, 'pending', 1, NOW())
       ON CONFLICT (environment, event_id) DO UPDATE SET
         attempt_count     = payments.razorpay_webhook_events.attempt_count + 1,
         processing_status = CASE
           WHEN payments.razorpay_webhook_events.processing_status = 'processed' THEN 'processed'
           ELSE 'pending'
         END,
         updated_at = NOW()
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

    const row = result.rows[0]!;
    const shouldProcess = row.processingStatus !== 'processed';

    if (!shouldProcess) {
      logger.info('Razorpay webhook event already processed — skipping', {
        environment,
        eventId,
        eventType: payload.event,
      });
    }

    return { shouldProcess, row };
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

    return result.rows[0]!;
  }
}
