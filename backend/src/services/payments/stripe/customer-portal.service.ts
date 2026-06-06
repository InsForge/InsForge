import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AppError } from '@/utils/errors.js';
import type { UserContext } from '@/api/middlewares/auth.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { StripeConfigService } from '@/services/payments/stripe/config.service.js';
import { toISOString } from '@/utils/dates.js';
import { withUserContext } from '@/services/database/user-context.service.js';
import logger from '@/utils/logger.js';
import type { CustomerPortalSessionRow, StripeCustomerPortalSession } from '@/types/payments.js';
import {
  type BillingSubject,
  ERROR_CODES,
  type CreateCustomerPortalSessionRequest,
  type CreateCustomerPortalSessionResponse,
  type CustomerPortalSession,
  type RoleSchema,
} from '@insforge/shared-schemas';

const CUSTOMER_PORTAL_SESSION_COLUMNS = `
  id,
  environment,
  status,
  subject_type AS "subjectType",
  subject_id AS "subjectId",
  customer_id AS "customerId",
  return_url AS "returnUrl",
  configuration_id AS "configuration",
  url,
  last_error AS "lastError",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const CUSTOMER_PORTAL_INSERT_ROLES = new Set<RoleSchema>(['authenticated', 'project_admin']);

export class StripeCustomerPortalService {
  private static instance: StripeCustomerPortalService;
  private pool: Pool | null = null;
  private readonly configService = StripeConfigService.getInstance();

  static getInstance(): StripeCustomerPortalService {
    if (!StripeCustomerPortalService.instance) {
      StripeCustomerPortalService.instance = new StripeCustomerPortalService();
    }

    return StripeCustomerPortalService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async createCustomerPortalSession(
    input: CreateCustomerPortalSessionRequest,
    user: UserContext
  ): Promise<CreateCustomerPortalSessionResponse> {
    if (user.role === 'anon') {
      throw new AppError(
        'Customer portal sessions require an authenticated user',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS
      );
    }

    const portalRecord = await this.insertInitializedCustomerPortalSession(input, user);

    try {
      const mapping = await this.findStripeCustomerMapping(input.environment, input.subject);
      if (!mapping) {
        throw new AppError(
          'No Stripe customer is mapped to this billing subject',
          404,
          ERROR_CODES.PAYMENT_NOT_FOUND
        );
      }

      const provider = await this.configService.createStripeProvider(input.environment);
      const portalSession = await provider.createCustomerPortalSession({
        customerId: mapping.providerCustomerId,
        returnUrl: input.returnUrl,
        configuration: input.configuration,
      });

      if (!portalSession.url) {
        throw new AppError(
          'Stripe did not return a customer portal URL',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      const customerPortalSession = await this.markCustomerPortalSessionCreated(
        portalRecord.id,
        mapping.providerCustomerId,
        portalSession
      );

      return { customerPortalSession };
    } catch (error) {
      await this.markCustomerPortalSessionFailed(portalRecord.id, error).catch((markError) => {
        logger.warn('Failed to mark Stripe customer portal session as failed', {
          environment: input.environment,
          customerPortalSessionId: portalRecord.id,
          error: markError instanceof Error ? markError.message : String(markError),
        });
      });
      throw error;
    }
  }

  async insertInitializedCustomerPortalSession(
    input: CreateCustomerPortalSessionRequest,
    user: UserContext
  ): Promise<{ id: string }> {
    const id = randomUUID();

    try {
      await withUserContext(this.getPool(), this.getSafeUserContext(user), async (client) => {
        await client.query(
          `INSERT INTO payments.stripe_customer_portal_sessions (
             id,
             environment,
             status,
             subject_type,
             subject_id,
             return_url,
             configuration_id
           )
           VALUES ($1, $2, 'initialized', $3, $4, $5, $6)`,
          [
            id,
            input.environment,
            input.subject.type,
            input.subject.id,
            input.returnUrl ?? null,
            input.configuration ?? null,
          ]
        );
      });

      return { id };
    } catch (error) {
      throw this.normalizeCustomerPortalInsertError(error);
    }
  }

  async markCustomerPortalSessionCreated(
    id: string,
    customerId: string,
    portalSession: StripeCustomerPortalSession
  ): Promise<CustomerPortalSession> {
    const result = await this.getPool().query(
      `UPDATE payments.stripe_customer_portal_sessions
       SET status = 'created',
           customer_id = $2,
           url = $3,
           raw = $4,
           last_error = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${CUSTOMER_PORTAL_SESSION_COLUMNS}`,
      [id, customerId, portalSession.url ?? null, portalSession]
    );

    return this.normalizeCustomerPortalSessionRow(this.requireRow(result.rows[0]));
  }

  async markCustomerPortalSessionFailed(
    id: string,
    error: unknown
  ): Promise<CustomerPortalSession | null> {
    const message = error instanceof Error ? error.message : String(error);
    const result = await this.getPool().query(
      `UPDATE payments.stripe_customer_portal_sessions
       SET status = 'failed',
           last_error = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${CUSTOMER_PORTAL_SESSION_COLUMNS}`,
      [id, message]
    );

    const row = result.rows[0] as CustomerPortalSessionRow | undefined;
    return row ? this.normalizeCustomerPortalSessionRow(row) : null;
  }

  private getSafeUserContext(user: UserContext): UserContext {
    return {
      id: user.id,
      email: user.email,
      role: this.getSafeRole(user.role),
    };
  }

  private getSafeRole(role: RoleSchema): RoleSchema {
    if (!CUSTOMER_PORTAL_INSERT_ROLES.has(role)) {
      throw new AppError('Unsupported customer portal role', 403, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    return role;
  }

  private normalizeCustomerPortalInsertError(error: unknown): Error {
    if (this.isPostgresPermissionError(error)) {
      return new AppError(
        'Customer portal session creation is not allowed by payments.stripe_customer_portal_sessions RLS policies',
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

  private normalizeCustomerPortalSessionRow(row: CustomerPortalSessionRow): CustomerPortalSession {
    return {
      id: row.id,
      environment: row.environment,
      status: row.status,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      customerId: row.customerId,
      returnUrl: row.returnUrl,
      configuration: row.configuration,
      url: row.url,
      lastError: row.lastError,
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  private async findStripeCustomerMapping(
    environment: string,
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

  private requireRow(row: unknown): CustomerPortalSessionRow {
    if (!row) {
      throw new AppError(
        'Customer portal session row was not found',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    return row as CustomerPortalSessionRow;
  }
}
