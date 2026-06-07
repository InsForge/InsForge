import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { RazorpayConfigService } from '@/services/payments/razorpay/config.service.js';
import type { RazorpayProvider } from '@/providers/payments/razorpay.provider.js';
import { AppError } from '@/utils/errors.js';
import { toISOString } from '@/utils/dates.js';
import { addBillingSubjectToMetadata } from '@/services/payments/helpers.js';
import {
  withPaymentSessionAdvisoryLock,
  type PaymentSessionAdvisoryLockMode,
} from '@/services/payments/payments-advisory-lock.js';
import logger from '@/utils/logger.js';
import type { RazorpayEnvironment, RazorpayOrderRow } from '@/types/payments.js';
import {
  ERROR_CODES,
  type BillingSubject,
  type CreateRazorpayOrderRequest,
  type CreateRazorpayOrderResponse,
  type CreateRazorpaySubscriptionRequest,
  type CreateRazorpaySubscriptionResponse,
  type RazorpayOrder,
  type RazorpaySubscription,
} from '@insforge/shared-schemas';

// ---------------------------------------------------------------------------
// SQL column list for razorpay_orders reads
// ---------------------------------------------------------------------------

const ORDER_COLUMNS = `
  id,
  environment,
  status,
  subject_type    AS "subjectType",
  subject_id      AS "subjectId",
  customer_id     AS "customerId",
  customer_email  AS "customerEmail",
  order_id        AS "orderId",
  amount,
  amount_paid     AS "amountPaid",
  amount_due      AS "amountDue",
  currency,
  description,
  metadata,
  last_error      AS "lastError",
  created_at      AS "createdAt",
  updated_at      AS "updatedAt"
`;

// ---------------------------------------------------------------------------
// Metadata key used to embed billing subject inside Razorpay order notes
// ---------------------------------------------------------------------------

const INSFORGE_ORDER_ID_NOTE = 'insforge_order_id';

export class RazorpayCheckoutService {
  private static instance: RazorpayCheckoutService;
  private pool: Pool | null = null;
  private readonly configService = RazorpayConfigService.getInstance();

  static getInstance(): RazorpayCheckoutService {
    if (!RazorpayCheckoutService.instance) {
      RazorpayCheckoutService.instance = new RazorpayCheckoutService();
    }
    return RazorpayCheckoutService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  // -------------------------------------------------------------------------
  // Advisory lock helpers — mirrors the pattern in StripeCheckoutService
  // -------------------------------------------------------------------------

  private async withSessionAdvisoryLock<T>(
    lockName: string,
    task: () => Promise<T>,
    mode: PaymentSessionAdvisoryLockMode = 'exclusive'
  ): Promise<T> {
    return withPaymentSessionAdvisoryLock(this.getPool(), lockName, task, mode);
  }

  private async withEnvironmentSharedLock<T>(
    environment: RazorpayEnvironment,
    task: () => Promise<T>
  ): Promise<T> {
    return this.withSessionAdvisoryLock(`razorpay_environment_${environment}`, task, 'shared');
  }

  private async withOrderIdempotencyLock<T>(
    environment: RazorpayEnvironment,
    idempotencyKey: string | null | undefined,
    task: () => Promise<T>
  ): Promise<T> {
    if (!idempotencyKey) {
      return task();
    }
    return this.withSessionAdvisoryLock(`razorpay_order_${environment}_${idempotencyKey}`, task);
  }

  private async withSubscriptionIdempotencyLock<T>(
    environment: RazorpayEnvironment,
    idempotencyKey: string | null | undefined,
    task: () => Promise<T>
  ): Promise<T> {
    if (!idempotencyKey) {
      return task();
    }
    return this.withSessionAdvisoryLock(`razorpay_sub_${environment}_${idempotencyKey}`, task);
  }

  // =========================================================================
  // CREATE ORDER  (one-time payment)
  // =========================================================================

  /**
   * Create a Razorpay Order and persist an InsForge order record.
   *
   * The response includes:
   *   - `order`  — the persisted InsForge record (with the Razorpay order_id)
   *   - `keyId`  — the Razorpay key ID (safe to expose; needed by frontend modal)
   *
   * The developer's frontend should use these to initialize the Razorpay JS
   * checkout modal:
   *   ```js
   *   const rzp = new Razorpay({ key: keyId, order_id: order.orderId, ... });
   *   rzp.open();
   *   ```
   */
  async createOrder(input: CreateRazorpayOrderRequest): Promise<CreateRazorpayOrderResponse> {
    const runOrder = async (): Promise<CreateRazorpayOrderResponse> => {
      // 1. Insert a placeholder record so we have a stable InsForge ID even
      //    before the Razorpay API call completes.
      const { id, existingOrder } = await this.insertInitializedOrder(input);

      if (existingOrder) {
        // Idempotent replay: return the already-created order.
        const keyId = await this.resolveKeyId(input.environment);
        return { attemptId: existingOrder.id, order: existingOrder, keyId };
      }

      const notes = this.buildNotes(input.metadata, input.subject, id);

      try {
        const provider = await this.configService.createRazorpayProvider(input.environment);
        const razorpayOrder = await provider.createOrder({
          amount: input.amount,
          currency: input.currency,
          notes,
          receipt: id,
        });

        const order = await this.markOrderCreated(id, razorpayOrder);
        const keyId = await this.resolveKeyId(input.environment);
        return { attemptId: id, order, keyId };
      } catch (error) {
        await this.markOrderFailed(id, error).catch((markError) => {
          logger.warn('Failed to mark Razorpay order as failed', {
            environment: input.environment,
            orderId: id,
            error: markError instanceof Error ? markError.message : String(markError),
          });
        });
        throw error;
      }
    };

    return this.withEnvironmentSharedLock(input.environment, () =>
      this.withOrderIdempotencyLock(input.environment, input.idempotencyKey, runOrder)
    );
  }

  // =========================================================================
  // CREATE SUBSCRIPTION  (recurring billing)
  // =========================================================================

  /**
   * Create a Razorpay Subscription and optionally resolve or create a
   * Razorpay customer for the given billing subject.
   *
   * The response includes:
   *   - `subscription` — the DB-persisted InsForge subscription record
   *   - `keyId`        — the Razorpay key ID (safe to expose)
   *   - `shortUrl`     — hosted payment page URL (redirect user here, or null)
   *
   * The developer's frontend should use these to drive the payment UX:
   *   ```js
   *   // Option A: use the Razorpay JS SDK directly
   *   const rzp = new Razorpay({ key: keyId, subscription_id: subscription.subscriptionId });
   *   rzp.open();
   *   // Option B: redirect to the hosted page
   *   if (shortUrl) window.location.href = shortUrl;
   *   ```
   */
  async createSubscription(
    input: CreateRazorpaySubscriptionRequest
  ): Promise<CreateRazorpaySubscriptionResponse> {
    const runSubscription = async (): Promise<CreateRazorpaySubscriptionResponse> => {
      const provider = await this.configService.createRazorpayProvider(input.environment);
      const db = DatabaseManager.getInstance().getPool();

      const resolvedIdempotencyKey = input.idempotencyKey ?? randomUUID();

      // 1. Guard idempotency at the DB level
      const attemptRes = await db.query(
        `INSERT INTO payments.razorpay_subscription_attempts (environment, idempotency_key)
         VALUES ($1, $2)
         ON CONFLICT (environment, idempotency_key) DO NOTHING
         RETURNING id, subscription_id`,
        [input.environment, resolvedIdempotencyKey]
      );

      if (attemptRes.rowCount === 0) {
        // Attempt already exists; find the existing subscription
        const existing = await db.query(
          `SELECT id, subscription_id FROM payments.razorpay_subscription_attempts
           WHERE environment = $1 AND idempotency_key = $2`,
          [input.environment, resolvedIdempotencyKey]
        );
        const subId = existing.rows[0]?.subscription_id;
        const attemptRecordId = existing.rows[0]?.id;
        if (!subId || !attemptRecordId) {
          throw new Error('Concurrent subscription attempt in progress or failed.');
        }
        const subRow = await db.query(
          `SELECT * FROM payments.razorpay_subscriptions WHERE environment = $1 AND subscription_id = $2`,
          [input.environment, subId]
        );
        if (subRow.rowCount === 0) {
          throw new Error(
            'Existing subscription attempt found but subscription record is missing.'
          );
        }
        const existingSub = this.normalizeSubscriptionRow(
          subRow.rows[0] as Record<string, unknown>
        );
        const keyId = await this.resolveKeyId(input.environment);
        return {
          attemptId: attemptRecordId,
          subscription: existingSub,
          keyId,
          shortUrl: existingSub.shortUrl ?? null,
        };
      }

      const attemptRecordId = (attemptRes.rows[0] as { id: string }).id;

      // 2. Resolve/Create customer
      const customerId = await this.resolveOrCreateCustomer(input, provider);

      const notes = this.buildNotes(input.metadata, input.subject);

      let razorpaySub;
      try {
        razorpaySub = await provider.createSubscription({
          planId: input.planId,
          totalCount: input.totalCount,
          quantity: input.quantity,
          startAt: input.startAt,
          customerId: customerId ?? undefined,
          notes,
        });
      } catch (err) {
        await db
          .query(`DELETE FROM payments.razorpay_subscription_attempts WHERE id = $1`, [
            attemptRecordId,
          ])
          .catch((deleteErr) => {
            logger.warn('Failed to clean up Razorpay subscription attempt after provider error', {
              environment: input.environment,
              attemptId: attemptRecordId,
              error: deleteErr instanceof Error ? deleteErr.message : String(deleteErr),
            });
          });
        throw err;
      }

      if (customerId) {
        // Persist / update the customer mapping for future lookups.
        await this.upsertCustomerMapping(input.environment, customerId, input.subject);
      }

      // Persist the subscription in our DB mirror so the admin UI and
      // list-subscriptions endpoint can surface it immediately without waiting
      // for the first webhook.
      const subscription = await this.upsertSubscriptionRecord(
        input.environment,
        razorpaySub,
        input.subject
      );

      // Record the created subscription ID in the attempt record
      await db.query(
        `UPDATE payments.razorpay_subscription_attempts
         SET subscription_id = $2
         WHERE id = $1`,
        [attemptRecordId, razorpaySub.id]
      );

      const keyId = await this.resolveKeyId(input.environment);
      return {
        attemptId: attemptRecordId,
        subscription,
        keyId,
        shortUrl: razorpaySub.short_url ?? null,
      };
    };

    return this.withEnvironmentSharedLock(input.environment, () =>
      this.withSubscriptionIdempotencyLock(input.environment, input.idempotencyKey, runSubscription)
    );
  }

  // =========================================================================
  // DB helpers — orders
  // =========================================================================

  private async insertInitializedOrder(
    input: CreateRazorpayOrderRequest
  ): Promise<{ id: string; existingOrder: RazorpayOrder | null }> {
    const id = randomUUID();

    const result = await this.getPool().query(
      `INSERT INTO payments.razorpay_orders (
         id,
         environment,
         status,
         subject_type,
         subject_id,
         customer_email,
         amount,
         amount_paid,
         amount_due,
         currency,
         description,
         idempotency_key,
         metadata
       )
       VALUES ($1, $2, 'initialized', $3, $4, $5, $6, 0, $6, $7, $8, $9, $10::JSONB)
       ON CONFLICT (environment, idempotency_key)
         WHERE idempotency_key IS NOT NULL
       DO NOTHING`,
      [
        id,
        input.environment,
        input.subject?.type ?? null,
        input.subject?.id ?? null,
        input.customerEmail ?? null,
        input.amount,
        input.currency,
        input.description ?? null,
        input.idempotencyKey ?? null,
        JSON.stringify(input.metadata ?? {}),
      ]
    );

    if (result.rowCount !== 0) {
      // Fresh insert succeeded — no prior idempotent match.
      return { id, existingOrder: null };
    }

    // ON CONFLICT DO NOTHING fired — find the existing record.
    const existing = await this.getPool().query(
      `SELECT ${ORDER_COLUMNS}
       FROM payments.razorpay_orders
       WHERE environment = $1
         AND idempotency_key = $2
       LIMIT 1`,
      [input.environment, input.idempotencyKey]
    );

    const row = existing.rows[0] as RazorpayOrderRow | undefined;
    if (!row) {
      throw new AppError(
        'Idempotency key is already used for a different order request',
        409,
        ERROR_CODES.PAYMENT_CHECKOUT_ALREADY_EXISTS
      );
    }

    return { id: row.id, existingOrder: this.normalizeOrderRow(row) };
  }

  private async markOrderCreated(
    id: string,
    razorpayOrder: {
      id: string;
      status: string;
      amount: number;
      amount_paid: number;
      amount_due: number;
      currency: string;
    }
  ): Promise<RazorpayOrder> {
    const result = await this.getPool().query(
      `UPDATE payments.razorpay_orders
       SET status       = 'created',
           order_id     = $2,
           amount       = $3,
           amount_paid  = $4,
           amount_due   = $5,
           currency     = $6,
           raw          = $7::JSONB,
           last_error   = NULL,
           updated_at   = NOW()
       WHERE id = $1
       RETURNING ${ORDER_COLUMNS}`,
      [
        id,
        razorpayOrder.id,
        razorpayOrder.amount,
        razorpayOrder.amount_paid,
        razorpayOrder.amount_due,
        razorpayOrder.currency,
        JSON.stringify(razorpayOrder),
      ]
    );

    return this.normalizeOrderRow(this.requireOrderRow(result.rows[0]));
  }

  private async markOrderFailed(id: string, error: unknown): Promise<RazorpayOrder | null> {
    const message = error instanceof Error ? error.message : String(error);
    const result = await this.getPool().query(
      `UPDATE payments.razorpay_orders
       SET status     = 'failed',
           last_error = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${ORDER_COLUMNS}`,
      [id, message]
    );

    const row = result.rows[0] as RazorpayOrderRow | undefined;
    return row ? this.normalizeOrderRow(row) : null;
  }

  // =========================================================================
  // DB helpers — subscriptions
  // =========================================================================

  /**
   * Write the freshly-created Razorpay subscription into our DB mirror.
   * This is a best-effort upsert — the authoritative copy will always come
   * from webhook events, but having the record immediately makes the admin
   * UI responsive.
   */
  private async upsertSubscriptionRecord(
    environment: RazorpayEnvironment,
    sub: {
      id: string;
      plan_id: string;
      customer_id: string | null;
      status: string;
      quantity: number;
      total_count: number | null;
      paid_count: number | null;
      remaining_count: number | null;
      current_start: number | null;
      current_end: number | null;
      ended_at: number | null;
      charge_at: number | null;
      start_at: number | null;
      end_at: number | null;
      short_url: string | null;
      has_scheduled_changes: boolean;
      change_scheduled_at: number | null;
      offer_id: string | null;
      notes: Record<string, string | number>;
      created_at: number;
    },
    subject: BillingSubject | undefined
  ): Promise<RazorpaySubscription> {
    const ts = (epochSeconds: number | null): Date | null =>
      epochSeconds ? new Date(epochSeconds * 1000) : null;

    const metadata: Record<string, string> = {};
    for (const [k, v] of Object.entries(sub.notes ?? {})) {
      metadata[k] = String(v);
    }

    const result = await this.getPool().query(
      `INSERT INTO payments.razorpay_subscriptions (
         environment,
         subscription_id,
         plan_id,
         customer_id,
         subject_type,
         subject_id,
         status,
         quantity,
         total_count,
         paid_count,
         remaining_count,
         current_start,
         current_end,
         ended_at,
         charge_at,
         start_at,
         end_at,
         short_url,
         has_scheduled_changes,
         change_scheduled_at,
         offer_id,
         metadata,
         raw,
         provider_created_at,
         synced_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::JSONB,$23::JSONB,$24,NOW())
       ON CONFLICT (environment, subscription_id) DO UPDATE SET
         plan_id              = EXCLUDED.plan_id,
         customer_id          = COALESCE(EXCLUDED.customer_id, payments.razorpay_subscriptions.customer_id),
         subject_type         = COALESCE(EXCLUDED.subject_type, payments.razorpay_subscriptions.subject_type),
         subject_id           = COALESCE(EXCLUDED.subject_id,   payments.razorpay_subscriptions.subject_id),
         status               = EXCLUDED.status,
         quantity             = EXCLUDED.quantity,
         total_count          = EXCLUDED.total_count,
         paid_count           = EXCLUDED.paid_count,
         remaining_count      = EXCLUDED.remaining_count,
         current_start        = EXCLUDED.current_start,
         current_end          = EXCLUDED.current_end,
         ended_at             = EXCLUDED.ended_at,
         charge_at            = EXCLUDED.charge_at,
         start_at             = EXCLUDED.start_at,
         end_at               = EXCLUDED.end_at,
         short_url            = COALESCE(EXCLUDED.short_url, payments.razorpay_subscriptions.short_url),
         has_scheduled_changes= EXCLUDED.has_scheduled_changes,
         change_scheduled_at  = EXCLUDED.change_scheduled_at,
         offer_id             = EXCLUDED.offer_id,
         metadata             = EXCLUDED.metadata,
         raw                  = EXCLUDED.raw,
         provider_created_at  = EXCLUDED.provider_created_at,
         synced_at            = NOW(),
         updated_at           = NOW()
       RETURNING
         environment,
         subscription_id        AS "subscriptionId",
         plan_id                AS "planId",
         customer_id            AS "customerId",
         subject_type           AS "subjectType",
         subject_id             AS "subjectId",
         status,
         current_start          AS "currentStart",
         current_end            AS "currentEnd",
         ended_at               AS "endedAt",
         quantity,
         charge_at              AS "chargeAt",
         start_at               AS "startAt",
         end_at                 AS "endAt",
         total_count            AS "totalCount",
         paid_count             AS "paidCount",
         remaining_count        AS "remainingCount",
         short_url              AS "shortUrl",
         has_scheduled_changes  AS "hasScheduledChanges",
         change_scheduled_at    AS "changeScheduledAt",
         offer_id               AS "offerId",
         metadata,
         provider_created_at    AS "providerCreatedAt",
         synced_at              AS "syncedAt",
         created_at             AS "createdAt",
         updated_at             AS "updatedAt"`,
      [
        environment,
        sub.id,
        sub.plan_id,
        sub.customer_id ?? null,
        subject?.type ?? null,
        subject?.id ?? null,
        sub.status,
        sub.quantity,
        sub.total_count ?? null,
        sub.paid_count ?? null,
        sub.remaining_count ?? null,
        ts(sub.current_start),
        ts(sub.current_end),
        ts(sub.ended_at),
        ts(sub.charge_at),
        ts(sub.start_at),
        ts(sub.end_at),
        sub.short_url ?? null,
        sub.has_scheduled_changes,
        ts(sub.change_scheduled_at),
        sub.offer_id ?? null,
        JSON.stringify(metadata),
        JSON.stringify(sub),
        ts(sub.created_at),
      ]
    );

    const row = result.rows[0] as Record<string, unknown>;
    return this.normalizeSubscriptionRow(row);
  }

  // =========================================================================
  // Customer resolution — the customer mapping flow
  // =========================================================================

  /**
   * Look up an existing Razorpay customer for the billing subject, or create
   * one if the subject is provided along with a customer email.
   *
   * Returns the Razorpay customer ID (cust_XXX) or null if neither a mapping
   * nor an email was provided.
   */
  private async resolveOrCreateCustomer(
    input: {
      environment: RazorpayEnvironment;
      subject?: BillingSubject;
      customerEmail?: string | null;
    },
    provider: RazorpayProvider
  ): Promise<string | null> {
    if (!input.subject) {
      return null;
    }

    // 1. Check for an existing customer mapping for this billing subject.
    const existing = await this.findCustomerMapping(input.environment, input.subject);
    if (existing) {
      return existing;
    }

    // 2. No existing mapping — create a new Razorpay customer if we have an email.
    if (!input.customerEmail) {
      return null;
    }

    const customer = await provider.createCustomer({
      email: input.customerEmail,
      notes: {
        insforge_subject_type: input.subject.type,
        insforge_subject_id: input.subject.id,
      },
    });

    return customer.id;
  }

  private async findCustomerMapping(
    environment: RazorpayEnvironment,
    subject: BillingSubject
  ): Promise<string | null> {
    const result = await this.getPool().query(
      `SELECT provider_customer_id AS "providerCustomerId"
       FROM payments.customer_mappings
       WHERE provider = 'razorpay'
         AND environment = $1
         AND subject_type = $2
         AND subject_id = $3
       LIMIT 1`,
      [environment, subject.type, subject.id]
    );

    const row = result.rows[0] as { providerCustomerId: string } | undefined;
    return row?.providerCustomerId ?? null;
  }

  private async upsertCustomerMapping(
    environment: RazorpayEnvironment,
    customerId: string,
    subject: BillingSubject | undefined
  ): Promise<void> {
    if (!subject) {
      return;
    }

    await this.getPool().query(
      `INSERT INTO payments.customer_mappings (provider, environment, subject_type, subject_id, provider_customer_id)
       VALUES ('razorpay', $1, $2, $3, $4)
       ON CONFLICT (provider, environment, subject_type, subject_id) DO UPDATE SET
         provider_customer_id = EXCLUDED.provider_customer_id,
         updated_at           = NOW()`,
      [environment, subject.type, subject.id, customerId]
    );
  }

  // =========================================================================
  // Normalizers
  // =========================================================================

  private normalizeOrderRow(row: RazorpayOrderRow): RazorpayOrder {
    return {
      id: row.id,
      environment: row.environment,
      status: row.status,
      subjectType: row.subjectType ?? null,
      subjectId: row.subjectId ?? null,
      customerId: row.customerId ?? null,
      customerEmail: row.customerEmail ?? null,
      orderId: row.orderId ?? null,
      amount: Number(row.amount),
      amountPaid: Number(row.amountPaid),
      amountDue: Number(row.amountDue),
      currency: row.currency,
      description: row.description ?? null,
      metadata: row.metadata ?? {},
      lastError: row.lastError ?? null,
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  private normalizeSubscriptionRow(row: Record<string, unknown>): RazorpaySubscription {
    const toStr = (v: unknown): string | null => {
      if (!v) {
        return null;
      }
      if (v instanceof Date) {
        return v.toISOString();
      }
      if (typeof v === 'string') {
        return v;
      }
      return null;
    };

    return {
      environment: row.environment as RazorpayEnvironment,
      subscriptionId: row.subscriptionId as string,
      planId: row.planId as string,
      customerId: (row.customerId as string | null) ?? null,
      subjectType: (row.subjectType as string | null) ?? null,
      subjectId: (row.subjectId as string | null) ?? null,
      status: row.status as RazorpaySubscription['status'],
      currentStart: toStr(row.currentStart),
      currentEnd: toStr(row.currentEnd),
      endedAt: toStr(row.endedAt),
      quantity: row.quantity === null ? null : Number(row.quantity),
      chargeAt: toStr(row.chargeAt),
      startAt: toStr(row.startAt),
      endAt: toStr(row.endAt),
      totalCount: row.totalCount === null ? null : Number(row.totalCount),
      paidCount: row.paidCount === null ? null : Number(row.paidCount),
      remainingCount: row.remainingCount === null ? null : Number(row.remainingCount),
      shortUrl: (row.shortUrl as string | null) ?? null,
      hasScheduledChanges: Boolean(row.hasScheduledChanges),
      changeScheduledAt: toStr(row.changeScheduledAt),
      offerId: (row.offerId as string | null) ?? null,
      metadata: (row.metadata as Record<string, string>) ?? {},
      providerCreatedAt: toStr(row.providerCreatedAt),
      syncedAt: toStr(row.syncedAt) ?? new Date().toISOString(),
      createdAt: toStr(row.createdAt) ?? new Date().toISOString(),
      updatedAt: toStr(row.updatedAt) ?? new Date().toISOString(),
    };
  }

  // =========================================================================
  // Utility helpers
  // =========================================================================

  private async resolveKeyId(environment: RazorpayEnvironment): Promise<string> {
    const keyId = await this.configService.getRazorpayKeyId(environment);
    if (!keyId) {
      throw new AppError(
        `Razorpay ${environment} key ID is not configured`,
        400,
        ERROR_CODES.PAYMENT_CONFIG_NOT_FOUND
      );
    }
    return keyId;
  }

  /**
   * Build the notes object that will be forwarded to Razorpay.
   * Razorpay notes support up to 15 key-value pairs. We embed the InsForge
   * billing subject and the internal order ID so webhooks can be correlated
   * back to the original request without scanning the entire database.
   */
  private buildNotes(
    metadata: Record<string, string> | undefined,
    subject: BillingSubject | undefined,
    insforgeOrderId?: string
  ): Record<string, string> {
    const notes: Record<string, string> = { ...(metadata ?? {}) };

    if (subject) {
      addBillingSubjectToMetadata(notes, subject);
    }

    if (insforgeOrderId) {
      notes[INSFORGE_ORDER_ID_NOTE] = insforgeOrderId;
    }

    return notes;
  }

  private requireOrderRow(row: unknown): RazorpayOrderRow {
    if (!row) {
      throw new AppError('Order row was not found', 500, ERROR_CODES.INTERNAL_ERROR);
    }
    return row as RazorpayOrderRow;
  }
}
