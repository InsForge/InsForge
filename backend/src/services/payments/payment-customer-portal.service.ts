import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '@/api/middlewares/error.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { toISOString } from '@/services/payments/helpers.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type { CustomerPortalSessionRow, StripeCustomerPortalSession } from '@/types/payments.js';
import type {
  CreateCustomerPortalSessionRequest,
  CustomerPortalSession,
  RoleSchema,
} from '@insforge/shared-schemas';

const CUSTOMER_PORTAL_SESSION_COLUMNS = `
  id,
  environment,
  status,
  subject_type AS "subjectType",
  subject_id AS "subjectId",
  stripe_customer_id AS "stripeCustomerId",
  return_url AS "returnUrl",
  configuration_id AS "configuration",
  url,
  last_error AS "lastError",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const CUSTOMER_PORTAL_INSERT_ROLES = new Set<RoleSchema>(['authenticated', 'project_admin']);

export interface CustomerPortalUserContext {
  id: string;
  email: string;
  role: RoleSchema;
}

export class PaymentCustomerPortalService {
  private static instance: PaymentCustomerPortalService;
  private pool: Pool | null = null;

  static getInstance(): PaymentCustomerPortalService {
    if (!PaymentCustomerPortalService.instance) {
      PaymentCustomerPortalService.instance = new PaymentCustomerPortalService();
    }

    return PaymentCustomerPortalService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async insertInitializedCustomerPortalSession(
    input: CreateCustomerPortalSessionRequest,
    user: CustomerPortalUserContext
  ): Promise<{ id: string }> {
    const id = randomUUID();
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${this.getSafeRole(user.role)}`);
      await this.setRequestContext(client, user);
      await client.query(
        `INSERT INTO payments.customer_portal_sessions (
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
      await client.query('COMMIT');

      return { id };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw this.normalizeCustomerPortalInsertError(error);
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      client.release();
    }
  }

  async markCustomerPortalSessionCreated(
    id: string,
    stripeCustomerId: string,
    portalSession: StripeCustomerPortalSession
  ): Promise<CustomerPortalSession> {
    const result = await this.getPool().query(
      `UPDATE payments.customer_portal_sessions
       SET status = 'created',
           stripe_customer_id = $2,
           url = $3,
           raw = $4,
           last_error = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${CUSTOMER_PORTAL_SESSION_COLUMNS}`,
      [id, stripeCustomerId, portalSession.url ?? null, portalSession]
    );

    return this.normalizeCustomerPortalSessionRow(this.requireRow(result.rows[0]));
  }

  async markCustomerPortalSessionFailed(
    id: string,
    error: unknown
  ): Promise<CustomerPortalSession | null> {
    const message = error instanceof Error ? error.message : String(error);
    const result = await this.getPool().query(
      `UPDATE payments.customer_portal_sessions
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

  private async setRequestContext(
    client: PoolClient,
    user: CustomerPortalUserContext
  ): Promise<void> {
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user.id]);
    await client.query("SELECT set_config('request.jwt.claim.role', $1, true)", [user.role]);
    await client.query("SELECT set_config('request.jwt.claim.email', $1, true)", [user.email]);
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
        'Customer portal session creation is not allowed by payments.customer_portal_sessions RLS policies',
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
      stripeCustomerId: row.stripeCustomerId,
      returnUrl: row.returnUrl,
      configuration: row.configuration,
      url: row.url,
      lastError: row.lastError,
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
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
