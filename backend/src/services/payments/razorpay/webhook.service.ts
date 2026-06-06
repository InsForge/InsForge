import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { RazorpayConfigService } from '@/services/payments/razorpay/config.service.js';
import { RazorpayWebhookHandlerService } from '@/services/payments/razorpay/webhook-handlers.service.js';
import { AppError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';
import type { RazorpayWebhookPayload } from '@/providers/payments/razorpay.provider.js';
import type { RazorpayEnvironment } from '@/types/payments.js';
import { ERROR_CODES, type RazorpayWebhookResponse } from '@insforge/shared-schemas';

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
  private readonly configService = RazorpayConfigService.getInstance();
  private readonly handlerService = RazorpayWebhookHandlerService.getInstance();

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

  async handleRazorpayWebhook(
    environment: RazorpayEnvironment,
    rawBodyBuffer: Buffer,
    signature: string,
    headerEventId?: string
  ): Promise<RazorpayWebhookResponse> {
    const webhookSecret = await this.configService.getRazorpayWebhookSecret(environment);
    if (!webhookSecret) {
      throw new AppError(
        `Razorpay ${environment} webhook secret is not configured`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const provider = await this.configService.createRazorpayProvider(environment);
    const rawBody = rawBodyBuffer.toString('utf8');
    const isValid = provider.verifyWebhookSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      throw new AppError('Invalid Razorpay webhook signature', 400, ERROR_CODES.INVALID_INPUT);
    }

    const payload = this.parseWebhookPayload(rawBody);
    const eventId = this.getWebhookEventId(payload, headerEventId);
    const eventStart = await this.recordWebhookEventStart(
      environment,
      eventId,
      payload.event,
      payload
    );

    if (!eventStart.shouldProcess) {
      return { received: true, handled: false };
    }

    if (!this.isHandledEvent(payload.event)) {
      await this.markWebhookEvent(environment, eventId, 'ignored', null);
      return { received: true, handled: false };
    }

    // Dispatch per-event handler in the background so we can return 200 fast.
    this.dispatchAfterAcknowledgement(environment, eventId, payload);
    return { received: true, handled: true };
  }

  /**
   * Record the start of a webhook event. Returns whether it should be processed
   * (i.e. it's not a duplicate already successfully processed).
   */
  async recordWebhookEventStart(
    environment: RazorpayEnvironment,
    eventId: string,
    eventType: string,
    payload: RazorpayWebhookPayload
  ): Promise<ShouldProcessResult> {
    const pendingReclaimCutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes

    const insertResult = await this.getPool().query<RazorpayWebhookEventRow>(
      `INSERT INTO payments.webhook_events
         (provider, environment, provider_event_id, event_type, livemode,
          processing_status, attempt_count, received_at, payload)
       VALUES ('razorpay', $1, $2, $3, $4, 'pending', 1, NOW(), $5)
       ON CONFLICT (provider, environment, provider_event_id) DO NOTHING
       RETURNING
         id,
         environment,
         provider_event_id  AS "eventId",
         event_type         AS "eventType",
         processing_status  AS "processingStatus",
         attempt_count      AS "attemptCount",
         last_error         AS "lastError",
         received_at        AS "receivedAt",
         processed_at       AS "processedAt"`,
      [environment, eventId, eventType, environment === 'live', payload]
    );

    const inserted = insertResult.rows[0];
    if (inserted) {
      return { row: inserted, shouldProcess: true };
    }

    const retryResult = await this.getPool().query<RazorpayWebhookEventRow>(
      `UPDATE payments.webhook_events
       SET processing_status = 'pending',
           attempt_count = attempt_count + 1,
           last_error = NULL,
           processed_at = NULL,
           payload = $4,
           updated_at = NOW()
       WHERE environment = $1
         AND provider = 'razorpay'
         AND provider_event_id = $2
         AND (
           processing_status = 'failed'
           OR (processing_status = 'pending' AND updated_at < $3)
         )
       RETURNING
         id,
         environment,
         provider_event_id  AS "eventId",
         event_type         AS "eventType",
         processing_status  AS "processingStatus",
         attempt_count      AS "attemptCount",
         last_error         AS "lastError",
         received_at        AS "receivedAt",
         processed_at       AS "processedAt"`,
      [environment, eventId, pendingReclaimCutoff, payload]
    );

    const retried = retryResult.rows[0];
    if (retried) {
      return { row: retried, shouldProcess: true };
    }

    const existingResult = await this.getPool().query<RazorpayWebhookEventRow>(
      `SELECT
         id,
         environment,
         provider_event_id  AS "eventId",
         event_type         AS "eventType",
         processing_status  AS "processingStatus",
         attempt_count      AS "attemptCount",
         last_error         AS "lastError",
         received_at        AS "receivedAt",
         processed_at       AS "processedAt"
       FROM payments.webhook_events
       WHERE provider = 'razorpay'
         AND environment = $1
         AND provider_event_id = $2`,
      [environment, eventId]
    );

    const row = existingResult.rows[0] as RazorpayWebhookEventRow;
    logger.info('Razorpay webhook event already processed or currently processing; skipping', {
      environment,
      eventId,
      eventType,
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
      `UPDATE payments.webhook_events
       SET processing_status = $3,
           last_error        = $4,
           processed_at      = CASE WHEN $3 IN ('processed', 'ignored') THEN NOW() ELSE processed_at END,
           updated_at        = NOW()
       WHERE provider = 'razorpay'
         AND environment = $1
         AND provider_event_id = $2
       RETURNING
         id,
         environment,
         provider_event_id  AS "eventId",
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

  private parseWebhookPayload(rawBody: string): RazorpayWebhookPayload {
    try {
      return JSON.parse(rawBody) as RazorpayWebhookPayload;
    } catch {
      throw new AppError('Invalid Razorpay webhook payload', 400, ERROR_CODES.INVALID_INPUT);
    }
  }

  private getWebhookEventId(payload: RazorpayWebhookPayload, headerEventId: string | undefined) {
    if (headerEventId) {
      return headerEventId;
    }

    const entityType = payload.contains?.[0];
    const entityId = this.getPayloadEntityId(payload, entityType);
    return `${payload.account_id}.${payload.event}.${entityId}.${payload.created_at}`;
  }

  private getPayloadEntityId(
    payload: RazorpayWebhookPayload,
    entityType: string | undefined
  ): string {
    if (!entityType) {
      return 'no_entity';
    }

    const entityPayload = payload.payload[entityType];
    if (!this.isRecord(entityPayload)) {
      return 'no_entity';
    }

    const entity = entityPayload.entity;
    if (!this.isRecord(entity) || typeof entity.id !== 'string') {
      return 'no_entity';
    }

    return entity.id;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isHandledEvent(event: string): boolean {
    return HANDLED_RAZORPAY_EVENTS.has(event);
  }

  private dispatchAfterAcknowledgement(
    environment: RazorpayEnvironment,
    eventId: string,
    payload: RazorpayWebhookPayload
  ): void {
    setImmediate(() => {
      this.handlerService
        .dispatch(environment, payload)
        .then(async (handled) => {
          const status = handled ? 'processed' : 'ignored';
          await this.markWebhookEvent(environment, eventId, status, null);
        })
        .catch(async (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.error('[Razorpay Webhook] Per-event handler failed', {
            environment,
            eventId,
            event: payload.event,
            error: message,
          });
          await this.markWebhookEvent(environment, eventId, 'failed', message);
        });
    });
  }
}

const HANDLED_RAZORPAY_EVENTS = new Set([
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'subscription.created',
  'subscription.activated',
  'subscription.charged',
  'subscription.updated',
  'subscription.cancelled',
  'subscription.paused',
  'subscription.resumed',
  'subscription.halted',
  'subscription.completed',
  'subscription.expired',
  'refund.created',
  'refund.failed',
  'invoice.paid',
  'invoice.expired',
  'order.paid',
]);
