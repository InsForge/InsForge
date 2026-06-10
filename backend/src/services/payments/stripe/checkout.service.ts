import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '@/utils/errors.js';
import type { UserContext } from '@/api/middlewares/auth.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { StripeConfigService } from '@/services/payments/stripe/config.service.js';
import {
  STRIPE_CHECKOUT_MODE_METADATA_KEY,
  STRIPE_CHECKOUT_SESSION_METADATA_KEY,
} from '@/services/payments/stripe/constants.js';
import {
  addBillingSubjectToProviderAttributes,
  buildStripeIdempotencyKey,
  getStripeObjectId,
  isPostgresPermissionError,
} from '@/services/payments/helpers.js';
import {
  withPaymentSessionAdvisoryLock,
  type PaymentSessionAdvisoryLockMode,
} from '@/services/payments/payments-advisory-lock.js';
import { toISOString } from '@/utils/dates.js';
import { withUserContext } from '@/services/database/user-context.service.js';
import logger from '@/utils/logger.js';
import type {
  CheckoutSessionPaymentStatus,
  CheckoutSessionRow,
  CheckoutSessionStatus,
  StripeCheckoutSession,
  StripeEnvironment,
} from '@/types/payments.js';
import {
  ERROR_CODES,
  type BillingSubject,
  type CheckoutSession,
  type CreateCheckoutSessionResponse,
  type CreateCheckoutSessionRequest,
  type RoleSchema,
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
  checkout_session_id AS "checkoutSessionId",
  customer_id AS "customerId",
  payment_intent_id AS "paymentIntentId",
  subscription_id AS "subscriptionId",
  url,
  last_error AS "lastError",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const CHECKOUT_INSERT_ROLES = new Set<RoleSchema>(['anon', 'authenticated', 'project_admin']);

export class StripeCheckoutService {
  private static instance: StripeCheckoutService;
  private pool: Pool | null = null;
  private readonly configService = StripeConfigService.getInstance();

  static getInstance(): StripeCheckoutService {
    if (!StripeCheckoutService.instance) {
      StripeCheckoutService.instance = new StripeCheckoutService();
    }

    return StripeCheckoutService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  private async withSessionAdvisoryLock<T>(
    lockName: string,
    task: () => Promise<T>,
    mode: PaymentSessionAdvisoryLockMode = 'exclusive'
  ): Promise<T> {
    return withPaymentSessionAdvisoryLock(this.getPool(), lockName, task, mode);
  }

  private async withEnvironmentSharedLock<T>(
    environment: StripeEnvironment,
    task: () => Promise<T>
  ): Promise<T> {
    return this.withSessionAdvisoryLock(`payments_environment_${environment}`, task, 'shared');
  }

  private async withCheckoutIdempotencyLock<T>(
    environment: StripeEnvironment,
    idempotencyKey: string | null | undefined,
    task: () => Promise<T>
  ): Promise<T> {
    if (!idempotencyKey) {
      return task();
    }

    return this.withSessionAdvisoryLock(`payments_checkout_${environment}_${idempotencyKey}`, task);
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionRequest,
    user: UserContext
  ): Promise<CreateCheckoutSessionResponse> {
    if (input.mode === 'subscription' && !input.subject) {
      throw new AppError(
        'Subscription checkout requires a billing subject',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const runCheckout = async (): Promise<CreateCheckoutSessionResponse> => {
      const baseMetadata = this.buildStripeMetadata(input.metadata, input.subject, input.mode);
      const checkoutRecord = await this.insertInitializedCheckoutSession(input, baseMetadata, user);
      if (
        checkoutRecord.existingCheckoutSession &&
        this.isUsableCheckoutSession(checkoutRecord.existingCheckoutSession)
      ) {
        return { checkoutSession: checkoutRecord.existingCheckoutSession };
      }

      const metadata = {
        ...baseMetadata,
        [STRIPE_CHECKOUT_SESSION_METADATA_KEY]: checkoutRecord.id,
      };

      try {
        const provider = await this.configService.createStripeProvider(input.environment);
        const customerId = await this.resolveCheckoutCustomer(input);
        const customerCreation =
          input.mode === 'payment' && input.subject && !customerId ? 'always' : undefined;
        const checkoutSession = await provider.createCheckoutSession({
          mode: input.mode,
          lineItems: input.lineItems,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
          customerId,
          customerEmail: customerId ? null : input.customerEmail,
          ...(customerCreation ? { customerCreation } : {}),
          clientReferenceId: checkoutRecord.id,
          metadata,
          idempotencyKey: buildStripeIdempotencyKey(
            input.environment,
            'checkout_session',
            input.idempotencyKey ?? checkoutRecord.id
          ),
        });

        return {
          checkoutSession: await this.markCheckoutSessionOpen(
            checkoutRecord.id,
            checkoutSession,
            metadata
          ),
        };
      } catch (error) {
        await this.markCheckoutSessionFailed(checkoutRecord.id, error).catch((markError) => {
          logger.warn('Failed to mark Stripe checkout session as failed', {
            environment: input.environment,
            checkoutSessionId: checkoutRecord.id,
            error: markError instanceof Error ? markError.message : String(markError),
          });
        });
        throw error;
      }
    };

    return this.withEnvironmentSharedLock(input.environment, () =>
      this.withCheckoutIdempotencyLock(input.environment, input.idempotencyKey, runCheckout)
    );
  }

  async insertInitializedCheckoutSession(
    input: CreateCheckoutSessionRequest,
    metadata: Record<string, string>,
    user: UserContext
  ): Promise<{ id: string; existingCheckoutSession: CheckoutSession | null }> {
    const id = randomUUID();

    try {
      return await withUserContext(
        this.getPool(),
        this.getSafeUserContext(user),
        async (client) => {
          const result = await client.query(
            `INSERT INTO payments.stripe_checkout_sessions (
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

          if (result.rowCount !== 0) {
            return { id, existingCheckoutSession: null };
          }

          const existingCheckoutSession = await this.findMatchingIdempotentCheckoutSession(
            client,
            input,
            metadata
          );
          return { id: existingCheckoutSession.id, existingCheckoutSession };
        }
      );
    } catch (error) {
      throw this.normalizeCheckoutInsertError(error);
    }
  }

  async markCheckoutSessionOpen(
    id: string,
    checkoutSession: StripeCheckoutSession,
    metadata: Record<string, string>
  ): Promise<CheckoutSession> {
    const result = await this.getPool().query(
      `UPDATE payments.stripe_checkout_sessions
       SET status = $2,
           payment_status = $3,
           checkout_session_id = $4,
           customer_id = $5,
           payment_intent_id = $6,
           subscription_id = $7,
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
      `UPDATE payments.stripe_checkout_sessions
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
      `UPDATE payments.stripe_checkout_sessions
       SET status = $3,
           payment_status = COALESCE($4, payment_status),
           customer_id = COALESCE($5, customer_id),
           payment_intent_id = COALESCE($6, payment_intent_id),
           subscription_id = COALESCE($7, subscription_id),
           url = COALESCE($8, url),
           raw = $9,
           last_error = NULL,
           updated_at = NOW()
       WHERE environment = $1
         AND checkout_session_id = $2
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
      checkoutSessionId: row.checkoutSessionId,
      customerId: row.customerId,
      paymentIntentId: row.paymentIntentId,
      subscriptionId: row.subscriptionId,
      url: row.url,
      lastError: row.lastError,
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  private isUsableCheckoutSession(checkoutSession: CheckoutSession): boolean {
    return Boolean(checkoutSession.checkoutSessionId && checkoutSession.url);
  }

  private async resolveCheckoutCustomer(
    input: CreateCheckoutSessionRequest
  ): Promise<string | null> {
    if (!input.subject) {
      return null;
    }

    const existing = await this.findStripeCustomerMapping(input.environment, input.subject);
    return existing?.providerCustomerId ?? null;
  }

  private async findStripeCustomerMapping(
    environment: StripeEnvironment,
    subject: BillingSubject
  ): Promise<{ providerCustomerId: string } | null> {
    const result = await this.getPool().query(
      `SELECT provider_customer_id AS "providerCustomerId"
       FROM payments.customer_mappings
       WHERE provider = 'stripe'
         AND environment = $1
         AND subject_type = $2
         AND subject_id = $3`,
      [environment, subject.type, subject.id]
    );

    return (result.rows[0] as { providerCustomerId: string } | undefined) ?? null;
  }

  private buildStripeMetadata(
    metadata: Record<string, string> | undefined,
    subject: BillingSubject | undefined,
    checkoutMode?: 'payment' | 'subscription'
  ): Record<string, string> {
    const reservedKey = Object.keys(metadata ?? {}).find((key) => key.startsWith('insforge_'));
    if (reservedKey) {
      throw new AppError(
        `Metadata key ${reservedKey} is reserved for InsForge`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const stripeMetadata = { ...(metadata ?? {}) };
    if (checkoutMode) {
      stripeMetadata[STRIPE_CHECKOUT_MODE_METADATA_KEY] = checkoutMode;
    }

    if (subject) {
      addBillingSubjectToProviderAttributes(stripeMetadata, subject);
    }

    return stripeMetadata;
  }

  private async findMatchingIdempotentCheckoutSession(
    client: PoolClient,
    input: CreateCheckoutSessionRequest,
    metadata: Record<string, string>
  ): Promise<CheckoutSession> {
    if (!input.idempotencyKey) {
      throw new AppError('Checkout session was not created', 500, ERROR_CODES.INTERNAL_ERROR);
    }

    const result = await client.query(
      `SELECT ${CHECKOUT_SESSION_COLUMNS}
       FROM payments.stripe_checkout_sessions
       WHERE environment = $1
         AND idempotency_key = $2
         AND mode = $3
         AND subject_type IS NOT DISTINCT FROM $4
         AND subject_id IS NOT DISTINCT FROM $5
         AND customer_email IS NOT DISTINCT FROM $6
         AND line_items = $7::JSONB
         AND success_url = $8
         AND cancel_url = $9
         AND metadata = $10::JSONB
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
        JSON.stringify(metadata),
      ]
    );

    const row = result.rows[0] as CheckoutSessionRow | undefined;
    if (!row) {
      throw new AppError(
        'Idempotency key is already used for another checkout request',
        409,
        ERROR_CODES.PAYMENT_CHECKOUT_ALREADY_EXISTS
      );
    }

    return this.normalizeCheckoutSessionRow(row);
  }

  private getSafeUserContext(user: UserContext): UserContext {
    return {
      id: user.id,
      email: user.email,
      role: this.getSafeRole(user.role),
    };
  }

  private getSafeRole(role: RoleSchema): RoleSchema {
    if (!CHECKOUT_INSERT_ROLES.has(role)) {
      throw new AppError('Unsupported checkout role', 403, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    return role;
  }

  private normalizeCheckoutInsertError(error: unknown): Error {
    if (isPostgresPermissionError(error)) {
      return new AppError(
        'Checkout session creation is not allowed by payments.stripe_checkout_sessions RLS policies',
        403,
        ERROR_CODES.AUTH_UNAUTHORIZED
      );
    }

    return error instanceof Error ? error : new Error(String(error));
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
