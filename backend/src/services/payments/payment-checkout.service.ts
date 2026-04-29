import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '@/api/middlewares/error.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { getStripeObjectId, toISOString } from '@/services/payments/helpers.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type {
  CheckoutSessionPaymentStatus,
  CheckoutSessionRow,
  CheckoutSessionStatus,
  StripeCheckoutSession,
  StripeEnvironment,
} from '@/types/payments.js';
import type {
  CheckoutSession,
  CreateCheckoutSessionRequest,
  RoleSchema,
} from '@insforge/shared-schemas';

const CHECKOUT_SESSION_COLUMNS = `
  id,
  environment,
  mode,
  status,
  payment_status AS "paymentStatus",
  subject_type AS "subjectType",
  subject_id AS "subjectId",
  customer_email AS "customerEmail",
  stripe_checkout_session_id AS "stripeCheckoutSessionId",
  stripe_customer_id AS "stripeCustomerId",
  stripe_payment_intent_id AS "stripePaymentIntentId",
  stripe_subscription_id AS "stripeSubscriptionId",
  url,
  last_error AS "lastError",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const CHECKOUT_INSERT_ROLES = new Set<RoleSchema>(['anon', 'authenticated', 'project_admin']);

export interface CheckoutUserContext {
  id: string;
  email: string;
  role: RoleSchema;
}

export class PaymentCheckoutService {
  private static instance: PaymentCheckoutService;
  private pool: Pool | null = null;

  static getInstance(): PaymentCheckoutService {
    if (!PaymentCheckoutService.instance) {
      PaymentCheckoutService.instance = new PaymentCheckoutService();
    }

    return PaymentCheckoutService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async insertInitializedCheckoutSession(
    input: CreateCheckoutSessionRequest,
    metadata: Record<string, string>,
    user: CheckoutUserContext
  ): Promise<{ id: string; existingCheckoutSession: CheckoutSession | null }> {
    const id = randomUUID();
    const client = await this.getPool().connect();
    let inserted = false;
    let existingCheckoutSession: CheckoutSession | null = null;

    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${this.getSafeRole(user.role)}`);
      await this.setRequestContext(client, user);
      const result = await client.query(
        `INSERT INTO payments.checkout_sessions (
           id,
           environment,
           mode,
           status,
           subject_type,
           subject_id,
           customer_email,
           line_items,
           success_url,
           cancel_url,
           idempotency_key,
           metadata
         )
         VALUES ($1, $2, $3, 'initialized', $4, $5, $6, $7::JSONB, $8, $9, $10, $11::JSONB)
         ON CONFLICT (environment, idempotency_key)
           WHERE idempotency_key IS NOT NULL
         DO NOTHING`,
        [
          id,
          input.environment,
          input.mode,
          input.subject?.type ?? null,
          input.subject?.id ?? null,
          input.customerEmail ?? null,
          JSON.stringify(input.lineItems),
          input.successUrl,
          input.cancelUrl,
          input.idempotencyKey ?? null,
          JSON.stringify(metadata),
        ]
      );
      inserted = result.rowCount !== 0;
      if (!inserted) {
        existingCheckoutSession = await this.findMatchingIdempotentCheckoutSession(client, input);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw this.normalizeCheckoutInsertError(error);
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      client.release();
    }

    if (!inserted) {
      if (!existingCheckoutSession) {
        throw new AppError('Checkout session was not created', 500, ERROR_CODES.INTERNAL_ERROR);
      }
      return { id: existingCheckoutSession.id, existingCheckoutSession };
    }

    return { id, existingCheckoutSession: null };
  }

  async markCheckoutSessionOpen(
    id: string,
    checkoutSession: StripeCheckoutSession,
    metadata: Record<string, string>
  ): Promise<CheckoutSession> {
    const result = await this.getPool().query(
      `UPDATE payments.checkout_sessions
       SET status = $2,
           payment_status = $3,
           stripe_checkout_session_id = $4,
           stripe_customer_id = $5,
           stripe_payment_intent_id = $6,
           stripe_subscription_id = $7,
           url = $8,
           metadata = $9,
           raw = $10,
           last_error = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${CHECKOUT_SESSION_COLUMNS}`,
      [
        id,
        this.mapStripeCheckoutStatus(checkoutSession.status, 'open'),
        this.normalizePaymentStatus(checkoutSession.payment_status),
        checkoutSession.id,
        getStripeObjectId(checkoutSession.customer),
        getStripeObjectId(checkoutSession.payment_intent),
        getStripeObjectId(checkoutSession.subscription),
        checkoutSession.url ?? null,
        metadata,
        checkoutSession,
      ]
    );

    return this.normalizeCheckoutSessionRow(this.requireRow(result.rows[0]));
  }

  async markCheckoutSessionFailed(id: string, error: unknown): Promise<CheckoutSession | null> {
    const message = error instanceof Error ? error.message : String(error);
    const result = await this.getPool().query(
      `UPDATE payments.checkout_sessions
       SET status = 'failed',
           last_error = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${CHECKOUT_SESSION_COLUMNS}`,
      [id, message]
    );

    const row = result.rows[0] as CheckoutSessionRow | undefined;
    return row ? this.normalizeCheckoutSessionRow(row) : null;
  }

  async updateCheckoutSessionFromStripe(
    environment: StripeEnvironment,
    checkoutSession: StripeCheckoutSession,
    statusOverride?: CheckoutSessionStatus
  ): Promise<CheckoutSession | null> {
    const result = await this.getPool().query(
      `UPDATE payments.checkout_sessions
       SET status = $3,
           payment_status = COALESCE($4, payment_status),
           stripe_customer_id = COALESCE($5, stripe_customer_id),
           stripe_payment_intent_id = COALESCE($6, stripe_payment_intent_id),
           stripe_subscription_id = COALESCE($7, stripe_subscription_id),
           url = COALESCE($8, url),
           raw = $9,
           last_error = NULL,
           updated_at = NOW()
       WHERE environment = $1
         AND stripe_checkout_session_id = $2
       RETURNING ${CHECKOUT_SESSION_COLUMNS}`,
      [
        environment,
        checkoutSession.id,
        statusOverride ?? this.mapStripeCheckoutStatus(checkoutSession.status),
        this.normalizePaymentStatus(checkoutSession.payment_status),
        getStripeObjectId(checkoutSession.customer),
        getStripeObjectId(checkoutSession.payment_intent),
        getStripeObjectId(checkoutSession.subscription),
        checkoutSession.url ?? null,
        checkoutSession,
      ]
    );

    const row = result.rows[0] as CheckoutSessionRow | undefined;
    return row ? this.normalizeCheckoutSessionRow(row) : null;
  }

  normalizeCheckoutSessionRow(row: CheckoutSessionRow): CheckoutSession {
    return {
      id: row.id,
      environment: row.environment,
      mode: row.mode,
      status: row.status,
      paymentStatus: row.paymentStatus,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      customerEmail: row.customerEmail,
      stripeCheckoutSessionId: row.stripeCheckoutSessionId,
      stripeCustomerId: row.stripeCustomerId,
      stripePaymentIntentId: row.stripePaymentIntentId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      url: row.url,
      lastError: row.lastError,
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  private async findMatchingIdempotentCheckoutSession(
    client: PoolClient,
    input: CreateCheckoutSessionRequest
  ): Promise<CheckoutSession> {
    if (!input.idempotencyKey) {
      throw new AppError('Checkout session was not created', 500, ERROR_CODES.INTERNAL_ERROR);
    }

    const result = await client.query(
      `SELECT ${CHECKOUT_SESSION_COLUMNS}
       FROM payments.checkout_sessions
       WHERE environment = $1
         AND idempotency_key = $2
         AND mode = $3
         AND subject_type IS NOT DISTINCT FROM $4
         AND subject_id IS NOT DISTINCT FROM $5
         AND customer_email IS NOT DISTINCT FROM $6
         AND line_items = $7::JSONB
         AND success_url = $8
         AND cancel_url = $9
       LIMIT 1`,
      [
        input.environment,
        input.idempotencyKey,
        input.mode,
        input.subject?.type ?? null,
        input.subject?.id ?? null,
        input.customerEmail ?? null,
        JSON.stringify(input.lineItems),
        input.successUrl,
        input.cancelUrl,
      ]
    );

    const row = result.rows[0] as CheckoutSessionRow | undefined;
    if (!row) {
      throw new AppError(
        'Idempotency key is already used for another checkout request',
        409,
        ERROR_CODES.ALREADY_EXISTS
      );
    }

    return this.normalizeCheckoutSessionRow(row);
  }

  private async setRequestContext(client: PoolClient, user: CheckoutUserContext): Promise<void> {
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user.id]);
    await client.query("SELECT set_config('request.jwt.claim.role', $1, true)", [user.role]);
    await client.query("SELECT set_config('request.jwt.claim.email', $1, true)", [user.email]);
  }

  private getSafeRole(role: RoleSchema): RoleSchema {
    if (!CHECKOUT_INSERT_ROLES.has(role)) {
      throw new AppError('Unsupported checkout role', 403, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    return role;
  }

  private normalizeCheckoutInsertError(error: unknown): Error {
    if (this.isPostgresPermissionError(error)) {
      return new AppError(
        'Checkout session creation is not allowed by payments.checkout_sessions RLS policies',
        403,
        ERROR_CODES.AUTH_UNAUTHORIZED
      );
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  private isPostgresPermissionError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '42501'
    );
  }

  private mapStripeCheckoutStatus(
    stripeStatus: string | null | undefined,
    fallback: CheckoutSessionStatus = 'completed'
  ): CheckoutSessionStatus {
    if (stripeStatus === 'open' || stripeStatus === 'expired') {
      return stripeStatus;
    }

    if (stripeStatus === 'complete') {
      return 'completed';
    }

    return fallback;
  }

  private normalizePaymentStatus(
    paymentStatus: string | null | undefined
  ): CheckoutSessionPaymentStatus | null {
    if (
      paymentStatus === 'paid' ||
      paymentStatus === 'unpaid' ||
      paymentStatus === 'no_payment_required'
    ) {
      return paymentStatus;
    }

    return null;
  }

  private requireRow(row: unknown): CheckoutSessionRow {
    if (!row) {
      throw new AppError('Checkout session row was not found', 500, ERROR_CODES.INTERNAL_ERROR);
    }

    return row as CheckoutSessionRow;
  }
}
