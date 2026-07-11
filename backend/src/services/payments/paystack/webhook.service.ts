import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { PaystackConfigService } from '@/services/payments/paystack/config.service.js';
import { WebhookStoreService } from '@/services/payments/webhook-store.service.js';
import {
  PaystackTransactionService,
  type PaystackPaymentTransactionStatus,
} from '@/services/payments/paystack/transaction.service.js';
import { AppError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';
import type {
  PaystackRefundResource,
  PaystackTransactionResource,
} from '@/providers/payments/paystack.provider.js';
import type { PaystackEnvironment } from '@/types/payments.js';
import {
  ERROR_CODES,
  type BillingSubject,
  type PaystackWebhookResponse,
} from '@insforge/shared-schemas';

export type PaystackWebhookProcessingStatus = 'pending' | 'processed' | 'failed' | 'ignored';

export interface PaystackWebhookEventRow {
  id: string;
  environment: PaystackEnvironment;
  eventId: string;
  eventType: string;
  processingStatus: PaystackWebhookProcessingStatus;
  attemptCount: number;
  lastError: string | null;
  receivedAt: Date | string;
  processedAt: Date | string | null;
}

/** Paystack webhook payloads are flat: `{ event, data }` with no envelope. */
export interface PaystackWebhookPayload {
  event: string;
  data: Record<string, unknown>;
}

interface ShouldProcessResult {
  shouldProcess: boolean;
  row: PaystackWebhookEventRow;
}

interface PaystackChargeRowContext {
  subject: BillingSubject | null;
  customerEmail: string | null;
}

export class PaystackWebhookService {
  private static instance: PaystackWebhookService;
  private pool: Pool | null = null;
  private readonly configService = PaystackConfigService.getInstance();
  private readonly transactionService = PaystackTransactionService.getInstance();
  private readonly webhookStore = WebhookStoreService.getInstance();

  static getInstance(): PaystackWebhookService {
    if (!PaystackWebhookService.instance) {
      PaystackWebhookService.instance = new PaystackWebhookService();
    }
    return PaystackWebhookService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  async handlePaystackWebhook(
    environment: PaystackEnvironment,
    rawBody: Buffer,
    signature: string
  ): Promise<PaystackWebhookResponse> {
    const provider = await this.configService.createPaystackProvider(environment);
    const isValid = provider.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      throw new AppError(
        `Invalid Paystack webhook signature. Confirm the Paystack Dashboard webhook URL points to /api/webhooks/paystack/${environment} and the configured ${environment} secret key matches the Paystack account.`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const payload = this.parseWebhookPayload(rawBody.toString('utf8'));
    const eventId = this.getWebhookEventId(payload);
    const eventStart = await this.recordWebhookEventStart(
      environment,
      eventId,
      payload.event,
      payload
    );

    if (!eventStart.shouldProcess) {
      return { received: true, handled: false };
    }

    const handled = await this.processRecordedPaystackWebhookEvent(environment, eventId, payload);

    return { received: true, handled };
  }

  private async processRecordedPaystackWebhookEvent(
    environment: PaystackEnvironment,
    eventId: string,
    payload: PaystackWebhookPayload
  ): Promise<boolean> {
    if (!this.isHandledEvent(payload.event)) {
      await this.markWebhookEvent(environment, eventId, 'ignored', null);
      return false;
    }

    let handled: boolean;

    try {
      handled = await this.applyPaystackWebhookEvent(environment, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markWebhookEvent(environment, eventId, 'failed', message).catch((markError) => {
        logger.error('Failed to mark Paystack webhook event as failed', {
          environment,
          eventId,
          error: markError instanceof Error ? markError.message : String(markError),
          originalError: message,
        });
      });
      throw error;
    }

    try {
      await this.markWebhookEvent(environment, eventId, handled ? 'processed' : 'ignored', null);
      return handled;
    } catch (error) {
      logger.error('Failed to finalize Paystack webhook event after processing', {
        environment,
        eventId,
        handled,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Record the start of a webhook event. Returns whether it should be processed
   * (i.e. it's not a duplicate already successfully processed).
   */
  async recordWebhookEventStart(
    environment: PaystackEnvironment,
    eventId: string,
    eventType: string,
    payload: PaystackWebhookPayload
  ): Promise<ShouldProcessResult> {
    const result = await this.webhookStore.recordStart({
      provider: 'paystack',
      environment,
      eventId,
      eventType,
      livemode: environment === 'live',
      payload,
    });

    if (!result.shouldProcess) {
      logger.info('Paystack webhook event already processed or currently processing; skipping', {
        environment,
        eventId,
        eventType,
      });
    }

    return result;
  }

  async markWebhookEvent(
    environment: PaystackEnvironment,
    eventId: string,
    status: PaystackWebhookProcessingStatus,
    error: string | null
  ): Promise<PaystackWebhookEventRow> {
    return this.webhookStore.mark('paystack', environment, eventId, status, error);
  }

  private parseWebhookPayload(rawBody: string): PaystackWebhookPayload {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch {
      throw new AppError('Invalid Paystack webhook payload', 400, ERROR_CODES.INVALID_INPUT);
    }

    if (!this.isRecord(parsed) || typeof parsed.event !== 'string' || !this.isRecord(parsed.data)) {
      throw new AppError('Invalid Paystack webhook payload', 400, ERROR_CODES.INVALID_INPUT);
    }

    return { event: parsed.event, data: parsed.data };
  }

  /**
   * Paystack sends no event-id header, so derive a stable idempotency id from
   * the event type plus the payload entity: `${event}.${data.id ?? data.reference}`.
   */
  private getWebhookEventId(payload: PaystackWebhookPayload): string {
    const { id, reference } = payload.data;
    const entityId =
      typeof id === 'number' || typeof id === 'string'
        ? String(id)
        : typeof reference === 'string' && reference.length > 0
          ? reference
          : 'no_entity';

    return `${payload.event}.${entityId}`;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isHandledEvent(event: string): boolean {
    return HANDLED_PAYSTACK_EVENTS.has(event);
  }

  private async applyPaystackWebhookEvent(
    environment: PaystackEnvironment,
    payload: PaystackWebhookPayload
  ): Promise<boolean> {
    switch (payload.event) {
      case 'charge.success':
        return this.handleChargeSuccess(environment, payload);
      case 'refund.processed':
      case 'refund.failed':
        return this.handleRefund(environment, payload, payload.event);
      default:
        return false;
    }
  }

  private async handleChargeSuccess(
    environment: PaystackEnvironment,
    payload: PaystackWebhookPayload
  ): Promise<boolean> {
    const charge = this.getChargeEntity(payload);
    if (!charge) {
      logger.warn('[Paystack Webhook] charge.success: no transaction entity', {
        event: payload.event,
      });
      return false;
    }

    const rowContext = await this.markTransactionSuccessByReference(environment, charge);
    const status = await this.transactionService.upsertChargeTransaction(environment, charge, {
      subjectFallback: rowContext?.subject ?? null,
      customerEmailFallback: rowContext?.customerEmail ?? null,
    });

    logger.info('[Paystack Webhook] Charge success processed', {
      environment,
      reference: charge.reference,
      transactionId: String(charge.id),
      status,
    });
    return true;
  }

  private async handleRefund(
    environment: PaystackEnvironment,
    payload: PaystackWebhookPayload,
    event: string
  ): Promise<boolean> {
    const refund = this.getRefundEntity(payload);
    if (!refund) {
      logger.warn('[Paystack Webhook] refund event: no refund entity', { event });
      return false;
    }

    const refundStatus = this.mapRefundStatus(refund, event);
    await this.transactionService.upsertRefundTransaction(environment, refund, refundStatus);

    logger.info('[Paystack Webhook] Refund processed', {
      environment,
      event,
      refundId: String(refund.id),
      reference: this.getRefundTransactionReference(payload),
    });
    return true;
  }

  private mapRefundStatus(
    refund: PaystackRefundResource,
    event: string
  ): PaystackPaymentTransactionStatus {
    if (event === 'refund.failed' || refund.status === 'failed') {
      return 'failed';
    }

    if (event === 'refund.processed' || refund.status === 'processed') {
      return 'refunded';
    }

    return 'pending';
  }

  private getRefundEntity(payload: PaystackWebhookPayload): PaystackRefundResource | null {
    const { id, amount, currency } = payload.data;
    if (typeof id !== 'number' && typeof id !== 'string') {
      return null;
    }
    if (typeof amount !== 'number' || typeof currency !== 'string') {
      return null;
    }

    return payload.data as unknown as PaystackRefundResource;
  }

  private getChargeEntity(payload: PaystackWebhookPayload): PaystackTransactionResource | null {
    const { id, reference } = payload.data;
    if (typeof reference !== 'string' || reference.length === 0) {
      return null;
    }
    if (typeof id !== 'number' && typeof id !== 'string') {
      return null;
    }

    return payload.data as unknown as PaystackTransactionResource;
  }

  private getRefundTransactionReference(payload: PaystackWebhookPayload): string | null {
    const { transaction_reference: transactionReference, transaction, reference } = payload.data;
    if (typeof transactionReference === 'string' && transactionReference.length > 0) {
      return transactionReference;
    }
    if (this.isRecord(transaction) && typeof transaction.reference === 'string') {
      return transaction.reference;
    }
    if (typeof reference === 'string' && reference.length > 0) {
      return reference;
    }

    return null;
  }

  private async markTransactionSuccessByReference(
    environment: PaystackEnvironment,
    charge: PaystackTransactionResource
  ): Promise<PaystackChargeRowContext | null> {
    const result = await this.getPool().query(
      `UPDATE payments.paystack_transactions
       SET status = 'success',
           verified_transaction_id = COALESCE(verified_transaction_id, $3),
           verified_at = COALESCE(verified_at, NOW()),
           raw = $4,
           last_error = NULL,
           updated_at = NOW()
       WHERE environment = $1
         AND reference = $2
       RETURNING
         subject_type AS "subjectType",
         subject_id AS "subjectId",
         customer_email AS "customerEmail"`,
      [environment, charge.reference, String(charge.id), charge]
    );

    const row = result.rows[0] as
      | { subjectType: string | null; subjectId: string | null; customerEmail: string | null }
      | undefined;

    if (!row) {
      logger.warn('[Paystack Webhook] charge.success for unknown transaction reference', {
        environment,
        reference: charge.reference,
      });
      return null;
    }

    return {
      subject:
        row.subjectType && row.subjectId ? { type: row.subjectType, id: row.subjectId } : null,
      customerEmail: row.customerEmail,
    };
  }
}

const HANDLED_PAYSTACK_EVENTS = new Set(['charge.success', 'refund.processed', 'refund.failed']);
