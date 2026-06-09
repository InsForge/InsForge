import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { UserContext } from '@/api/middlewares/auth.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/utils/errors.js';
import {
  addBillingSubjectToMetadata,
  getBillingSubjectFromMetadata,
} from '@/services/payments/helpers.js';
import { withUserContext } from '@/services/database/user-context.service.js';
import { RazorpayConfigService } from '@/services/payments/razorpay/config.service.js';
import { toISOString, toISOStringOrNull } from '@/utils/dates.js';
import type { RazorpaySubscription } from '@/providers/payments/razorpay.provider.js';
import type { RazorpayEnvironment, RazorpaySubscriptionRow } from '@/types/payments.js';
import {
  ERROR_CODES,
  type BillingSubject,
  type CancelRazorpaySubscriptionRequest,
  type CancelRazorpaySubscriptionResponse,
  type CreateRazorpaySubscriptionRequest,
  type CreateRazorpaySubscriptionResponse,
  type ListRazorpaySubscriptionsRequest,
  type ListRazorpaySubscriptionsResponse,
  type PauseRazorpaySubscriptionRequest,
  type PauseRazorpaySubscriptionResponse,
  type ResumeRazorpaySubscriptionRequest,
  type ResumeRazorpaySubscriptionResponse,
  type RoleSchema,
  type VerifyRazorpaySubscriptionRequest,
  type VerifyRazorpaySubscriptionResponse,
} from '@insforge/shared-schemas';

const RAZORPAY_SUBSCRIPTION_COLUMNS = `
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
  auth_attempts AS "authAttempts",
  paid_count AS "paidCount",
  remaining_count AS "remainingCount",
  short_url AS "shortUrl",
  has_scheduled_changes AS "hasScheduledChanges",
  change_scheduled_at AS "changeScheduledAt",
  offer_id AS "offerId",
  authorization_payment_id AS "authorizationPaymentId",
  authorization_verified_at AS "authorizationVerifiedAt",
  metadata,
  provider_created_at AS "providerCreatedAt",
  synced_at AS "syncedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const SUBSCRIPTION_USER_ACTION_ROLES = new Set<RoleSchema>(['authenticated', 'project_admin']);

type RazorpaySubscriptionManagementInput = {
  environment: RazorpayEnvironment;
  subscriptionId: string;
};

export class RazorpaySubscriptionService {
  private static instance: RazorpaySubscriptionService;
  private pool: Pool | null = null;
  private readonly configService = RazorpayConfigService.getInstance();

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
         ${RAZORPAY_SUBSCRIPTION_COLUMNS}
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

  async createSubscription(
    input: CreateRazorpaySubscriptionRequest,
    user: UserContext
  ): Promise<CreateRazorpaySubscriptionResponse> {
    this.assertCanCreateSubscription(user);

    const metadata = this.buildMetadata(input.metadata, input.subject);
    await this.assertSubscriptionCreationAllowed(input, metadata, user);

    const provider = await this.configService.createRazorpayProvider(input.environment);
    const subscription = await provider.createSubscription({
      planId: input.planId,
      totalCount: input.totalCount ?? 1,
      endAt: input.endAt,
      quantity: input.quantity,
      startAt: input.startAt,
      expireBy: input.expireBy,
      customerNotify: input.customerNotify,
      offerId: input.offerId ?? null,
      notes: metadata,
    });
    const storedSubscription = await this.upsertSubscriptionFromProvider(
      input.environment,
      subscription,
      input.subject
    );

    return this.buildCreateSubscriptionResponse(provider.getKeyId(), storedSubscription, input);
  }

  private buildCreateSubscriptionResponse(
    keyId: string,
    storedSubscription: ListRazorpaySubscriptionsResponse['subscriptions'][number],
    input: CreateRazorpaySubscriptionRequest
  ): CreateRazorpaySubscriptionResponse {
    return {
      attemptId: storedSubscription.subscriptionId,
      subscription: storedSubscription,
      checkoutOptions: {
        keyId,
        subscriptionId: storedSubscription.subscriptionId,
        description: input.description ?? null,
        callbackUrl: input.callbackUrl ?? null,
        prefill: {
          name: input.customerName ?? null,
          email: input.customerEmail ?? null,
          contact: input.customerContact ?? null,
        },
      },
    };
  }

  async verifySubscriptionPayment(
    input: VerifyRazorpaySubscriptionRequest
  ): Promise<VerifyRazorpaySubscriptionResponse> {
    const provider = await this.configService.createRazorpayProvider(input.environment);
    if (
      !provider.verifySubscriptionPaymentSignature(
        input.subscriptionId,
        input.paymentId,
        input.signature
      )
    ) {
      throw new AppError('Invalid Razorpay subscription signature', 400, ERROR_CODES.INVALID_INPUT);
    }

    const result = await this.getPool().query(
      `UPDATE payments.razorpay_subscriptions
       SET authorization_payment_id = $3,
           authorization_verified_at = NOW(),
           status = CASE WHEN status = 'created' THEN 'authenticated' ELSE status END,
           updated_at = NOW()
       WHERE environment = $1
         AND subscription_id = $2
       RETURNING ${RAZORPAY_SUBSCRIPTION_COLUMNS}`,
      [input.environment, input.subscriptionId, input.paymentId]
    );

    const row = result.rows[0] as RazorpaySubscriptionRow | undefined;
    if (!row) {
      throw new AppError(
        `Razorpay ${input.environment} subscription not found: ${input.subscriptionId}`,
        404,
        ERROR_CODES.PAYMENT_NOT_FOUND
      );
    }

    return {
      verified: true,
      subscription: this.normalizeSubscriptionRow(row),
    };
  }

  async cancelSubscription(
    input: CancelRazorpaySubscriptionRequest,
    user: UserContext
  ): Promise<CancelRazorpaySubscriptionResponse> {
    this.assertCanManageSubscription(user);
    const subject = await this.assertSubscriptionManagementAllowed(input, user);
    const provider = await this.configService.createRazorpayProvider(input.environment);
    const subscription = await provider.cancelSubscription(input.subscriptionId, {
      cancelAtCycleEnd: input.cancelAtCycleEnd,
    });
    const storedSubscription = await this.upsertSubscriptionFromProvider(
      input.environment,
      subscription,
      subject
    );

    return { subscription: storedSubscription };
  }

  async pauseSubscription(
    input: PauseRazorpaySubscriptionRequest,
    user: UserContext
  ): Promise<PauseRazorpaySubscriptionResponse> {
    this.assertCanManageSubscription(user);
    const subject = await this.assertSubscriptionManagementAllowed(input, user);
    const provider = await this.configService.createRazorpayProvider(input.environment);
    const subscription = await provider.pauseSubscription(input.subscriptionId);
    const storedSubscription = await this.upsertSubscriptionFromProvider(
      input.environment,
      subscription,
      subject
    );

    return { subscription: storedSubscription };
  }

  async resumeSubscription(
    input: ResumeRazorpaySubscriptionRequest,
    user: UserContext
  ): Promise<ResumeRazorpaySubscriptionResponse> {
    this.assertCanManageSubscription(user);
    const subject = await this.assertSubscriptionManagementAllowed(input, user);
    const provider = await this.configService.createRazorpayProvider(input.environment);
    const subscription = await provider.resumeSubscription(input.subscriptionId);
    const storedSubscription = await this.upsertSubscriptionFromProvider(
      input.environment,
      subscription,
      subject
    );

    return { subscription: storedSubscription };
  }

  async upsertSubscriptionFromProvider(
    environment: RazorpayEnvironment,
    subscription: RazorpaySubscription,
    subjectOverride?: BillingSubject | null
  ): Promise<ListRazorpaySubscriptionsResponse['subscriptions'][number]> {
    const metadata = this.normalizeMetadata(subscription.notes);
    const subject =
      subjectOverride ??
      getBillingSubjectFromMetadata(metadata) ??
      (await this.resolveSubjectFromCustomerMapping(environment, subscription.customer_id));

    const result = await this.getPool().query(
      `INSERT INTO payments.razorpay_subscriptions (
         environment, subscription_id, plan_id, customer_id,
         subject_type, subject_id, status,
         current_start, current_end, ended_at,
         quantity, charge_at, start_at, end_at,
         total_count, auth_attempts, paid_count, remaining_count,
         short_url, has_scheduled_changes, change_scheduled_at,
         offer_id, metadata, raw, provider_created_at, synced_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW())
       ON CONFLICT (environment, subscription_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         customer_id = EXCLUDED.customer_id,
         subject_type = EXCLUDED.subject_type,
         subject_id = EXCLUDED.subject_id,
         status = EXCLUDED.status,
         current_start = EXCLUDED.current_start,
         current_end = EXCLUDED.current_end,
         ended_at = EXCLUDED.ended_at,
         quantity = EXCLUDED.quantity,
         charge_at = EXCLUDED.charge_at,
         start_at = EXCLUDED.start_at,
         end_at = EXCLUDED.end_at,
         total_count = EXCLUDED.total_count,
         auth_attempts = EXCLUDED.auth_attempts,
         paid_count = EXCLUDED.paid_count,
         remaining_count = EXCLUDED.remaining_count,
         short_url = EXCLUDED.short_url,
         has_scheduled_changes = EXCLUDED.has_scheduled_changes,
         change_scheduled_at = EXCLUDED.change_scheduled_at,
         offer_id = EXCLUDED.offer_id,
         metadata = EXCLUDED.metadata,
         raw = EXCLUDED.raw,
         provider_created_at = EXCLUDED.provider_created_at,
         synced_at = NOW(),
         updated_at = NOW()
       RETURNING ${RAZORPAY_SUBSCRIPTION_COLUMNS}`,
      [
        environment,
        subscription.id,
        subscription.plan_id,
        subscription.customer_id ?? null,
        subject?.type ?? null,
        subject?.id ?? null,
        subscription.status,
        this.fromRazorpayTimestamp(subscription.current_start),
        this.fromRazorpayTimestamp(subscription.current_end),
        this.fromRazorpayTimestamp(subscription.ended_at),
        subscription.quantity ?? null,
        this.fromRazorpayTimestamp(subscription.charge_at),
        this.fromRazorpayTimestamp(subscription.start_at),
        this.fromRazorpayTimestamp(subscription.end_at),
        subscription.total_count ?? null,
        subscription.auth_attempts ?? null,
        subscription.paid_count ?? null,
        subscription.remaining_count ?? null,
        subscription.short_url ?? null,
        subscription.has_scheduled_changes,
        this.fromRazorpayTimestamp(subscription.change_scheduled_at),
        subscription.offer_id ?? null,
        metadata,
        subscription,
        this.fromRazorpayTimestamp(subscription.created_at),
      ]
    );

    if (subject && subscription.customer_id) {
      await this.upsertCustomerMapping(environment, subject, subscription.customer_id);
    }

    return this.normalizeSubscriptionRow(this.requireRow(result.rows[0]));
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
      authAttempts: row.authAttempts === null ? null : Number(row.authAttempts),
      paidCount: row.paidCount === null ? null : Number(row.paidCount),
      remainingCount: row.remainingCount === null ? null : Number(row.remainingCount),
      shortUrl: row.shortUrl ?? null,
      hasScheduledChanges: row.hasScheduledChanges,
      changeScheduledAt: toISOStringOrNull(row.changeScheduledAt),
      offerId: row.offerId ?? null,
      authorizationPaymentId: row.authorizationPaymentId ?? null,
      authorizationVerifiedAt: toISOStringOrNull(row.authorizationVerifiedAt),
      metadata: row.metadata ?? {},
      providerCreatedAt: toISOStringOrNull(row.providerCreatedAt),
      syncedAt: toISOString(row.syncedAt),
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  private buildMetadata(
    metadata: Record<string, string> | undefined,
    subject: BillingSubject
  ): Record<string, string> {
    const razorpayMetadata = { ...(metadata ?? {}) };
    addBillingSubjectToMetadata(razorpayMetadata, subject);
    return razorpayMetadata;
  }

  private assertCanCreateSubscription(user: UserContext): void {
    if (!SUBSCRIPTION_USER_ACTION_ROLES.has(user.role)) {
      throw new AppError(
        'Razorpay subscription creation requires a user token',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS
      );
    }
  }

  private assertCanManageSubscription(user: UserContext): void {
    if (!SUBSCRIPTION_USER_ACTION_ROLES.has(user.role)) {
      throw new AppError(
        'Razorpay subscription management requires a user token',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS
      );
    }
  }

  private async assertSubscriptionCreationAllowed(
    input: CreateRazorpaySubscriptionRequest,
    metadata: Record<string, string>,
    user: UserContext
  ): Promise<void> {
    try {
      await withUserContext(this.getPool(), user, async (client) => {
        await client.query('SAVEPOINT razorpay_subscription_rls_probe');
        try {
          await client.query(
            `INSERT INTO payments.razorpay_subscriptions (
               environment,
               subscription_id,
               plan_id,
               subject_type,
               subject_id,
               status,
               quantity,
               start_at,
               end_at,
               total_count,
               metadata
             )
             VALUES ($1, $2, $3, $4, $5, 'created', $6, $7, $8, $9, $10::JSONB)`,
            [
              input.environment,
              this.buildSubscriptionAuthorizationProbeId(),
              input.planId,
              input.subject.type,
              input.subject.id,
              input.quantity ?? null,
              this.fromRazorpayTimestamp(input.startAt),
              this.fromRazorpayTimestamp(input.endAt),
              input.totalCount ?? null,
              JSON.stringify(metadata),
            ]
          );
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT razorpay_subscription_rls_probe');
          await client.query('RELEASE SAVEPOINT razorpay_subscription_rls_probe');
        }
      });
    } catch (error) {
      throw this.normalizeSubscriptionAuthorizationError(error, 'creation');
    }
  }

  private async assertSubscriptionManagementAllowed(
    input: RazorpaySubscriptionManagementInput,
    user: UserContext
  ): Promise<BillingSubject | null> {
    try {
      return await withUserContext(this.getPool(), user, async (client) => {
        await client.query('SAVEPOINT razorpay_subscription_rls_probe');
        try {
          const result = await client.query(
            `UPDATE payments.razorpay_subscriptions
             SET updated_at = updated_at
             WHERE environment = $1
               AND subscription_id = $2
             RETURNING subject_type AS "type", subject_id AS "id"`,
            [input.environment, input.subscriptionId]
          );
          const row = result.rows[0] as { type: string | null; id: string | null } | undefined;

          if (!row) {
            throw new AppError(
              `Razorpay ${input.environment} subscription not found or not manageable: ${input.subscriptionId}`,
              404,
              ERROR_CODES.PAYMENT_NOT_FOUND
            );
          }

          return row.type && row.id ? { type: row.type, id: row.id } : null;
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT razorpay_subscription_rls_probe');
          await client.query('RELEASE SAVEPOINT razorpay_subscription_rls_probe');
        }
      });
    } catch (error) {
      throw this.normalizeSubscriptionAuthorizationError(error, 'management');
    }
  }

  private buildSubscriptionAuthorizationProbeId(): string {
    return `sub_rls_probe_${randomUUID().replaceAll('-', '')}`;
  }

  private normalizeSubscriptionAuthorizationError(
    error: unknown,
    action: 'creation' | 'management'
  ): Error {
    if (error instanceof Error && 'code' in error && error.code === '42501') {
      return new AppError(
        `Razorpay subscription ${action} is not allowed by payments.razorpay_subscriptions RLS policies`,
        403,
        ERROR_CODES.AUTH_UNAUTHORIZED
      );
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  private normalizeMetadata(
    notes: Record<string, string | number | boolean> | undefined | null
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(notes ?? {}).map(([key, value]) => [key, String(value)])
    );
  }

  private fromRazorpayTimestamp(unixSeconds: number | null | undefined): Date | null {
    return unixSeconds ? new Date(unixSeconds * 1000) : null;
  }

  private async resolveSubjectFromCustomerMapping(
    environment: RazorpayEnvironment,
    customerId: string | null
  ): Promise<BillingSubject | null> {
    if (!customerId) {
      return null;
    }

    const result = await this.getPool().query(
      `SELECT subject_type AS "type", subject_id AS "id"
       FROM payments.customer_mappings
       WHERE provider = 'razorpay'
         AND environment = $1
         AND provider_customer_id = $2
       LIMIT 1`,
      [environment, customerId]
    );

    return (result.rows[0] as BillingSubject | undefined) ?? null;
  }

  private async upsertCustomerMapping(
    environment: RazorpayEnvironment,
    subject: BillingSubject,
    customerId: string
  ): Promise<void> {
    await this.getPool().query(
      `INSERT INTO payments.customer_mappings (
         provider,
         environment,
         subject_type,
         subject_id,
         provider_customer_id
       )
       VALUES ('razorpay', $1, $2, $3, $4)
       ON CONFLICT (provider, environment, subject_type, subject_id) DO UPDATE SET
         provider_customer_id = EXCLUDED.provider_customer_id,
         updated_at = NOW()`,
      [environment, subject.type, subject.id, customerId]
    );
  }

  private requireRow(row: unknown): RazorpaySubscriptionRow {
    if (!row) {
      throw new AppError('Razorpay subscription not found', 404, ERROR_CODES.PAYMENT_NOT_FOUND);
    }

    return row as RazorpaySubscriptionRow;
  }
}
