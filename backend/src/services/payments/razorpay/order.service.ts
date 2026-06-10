import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AppError } from '@/utils/errors.js';
import type { UserContext } from '@/api/middlewares/auth.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { RazorpayConfigService } from '@/services/payments/razorpay/config.service.js';
import {
  addBillingSubjectToProviderAttributes,
  isPostgresPermissionError,
} from '@/services/payments/helpers.js';
import { withUserContext } from '@/services/database/user-context.service.js';
import { toISOString, toISOStringOrNull } from '@/utils/dates.js';
import logger from '@/utils/logger.js';
import type {
  RazorpayEnvironment,
  RazorpayOrderRow,
  RazorpayOrderStatus,
} from '@/types/payments.js';
import type { RazorpayOrder } from '@/providers/payments/razorpay.provider.js';
import {
  ERROR_CODES,
  type CreateRazorpayOrderRequest,
  type CreateRazorpayOrderResponse,
  type RazorpayOrder as RazorpayOrderResponse,
  type RoleSchema,
  type VerifyRazorpayOrderRequest,
  type VerifyRazorpayOrderResponse,
} from '@insforge/shared-schemas';

const RAZORPAY_ORDER_NOTES_KEY = 'insforge_order_id';

const RAZORPAY_ORDER_COLUMNS = `
  id,
  environment,
  status,
  subject_type AS "subjectType",
  subject_id AS "subjectId",
  customer_name AS "customerName",
  customer_email AS "customerEmail",
  customer_contact AS "customerContact",
  order_id AS "orderId",
  receipt,
  amount,
  amount_paid AS "amountPaid",
  amount_due AS "amountDue",
  currency,
  attempts,
  verified_payment_id AS "verifiedPaymentId",
  verified_at AS "verifiedAt",
  notes,
  last_error AS "lastError",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const ORDER_INSERT_ROLES = new Set<RoleSchema>(['anon', 'authenticated', 'project_admin']);

export class RazorpayOrderService {
  private static instance: RazorpayOrderService;
  private pool: Pool | null = null;
  private readonly configService = RazorpayConfigService.getInstance();

  static getInstance(): RazorpayOrderService {
    if (!RazorpayOrderService.instance) {
      RazorpayOrderService.instance = new RazorpayOrderService();
    }

    return RazorpayOrderService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async createOrder(
    input: CreateRazorpayOrderRequest,
    user: UserContext
  ): Promise<CreateRazorpayOrderResponse> {
    const notes = this.buildNotes(input.notes, input.subject);
    const initialized = await this.insertInitializedOrder(input, notes, user);
    const providerNotes = {
      ...notes,
      [RAZORPAY_ORDER_NOTES_KEY]: initialized.id,
    };

    try {
      const provider = await this.configService.createRazorpayProvider(input.environment);
      const order = await provider.createOrder({
        amount: input.amount,
        currency: input.currency,
        receipt: initialized.receipt,
        notes: providerNotes,
      });
      const storedOrder = await this.markOrderCreated(initialized.id, order, providerNotes);
      return this.buildCreateOrderResponse(provider.getKeyId(), storedOrder, input);
    } catch (error) {
      await this.markOrderFailed(initialized.id, error).catch((markError) => {
        logger.warn('Failed to mark Razorpay order as failed', {
          environment: input.environment,
          orderRecordId: initialized.id,
          error: markError instanceof Error ? markError.message : String(markError),
        });
      });
      throw error;
    }
  }

  async verifyOrderPayment(
    input: VerifyRazorpayOrderRequest
  ): Promise<VerifyRazorpayOrderResponse> {
    const provider = await this.configService.createRazorpayProvider(input.environment);
    if (!provider.verifyOrderPaymentSignature(input.orderId, input.paymentId, input.signature)) {
      throw new AppError('Invalid Razorpay payment signature', 400, ERROR_CODES.INVALID_INPUT);
    }

    const order = await this.markOrderVerified(input.environment, input.orderId, input.paymentId);
    return { verified: true, order };
  }

  private async insertInitializedOrder(
    input: CreateRazorpayOrderRequest,
    notes: Record<string, string>,
    user: UserContext
  ): Promise<{ id: string; receipt: string }> {
    const id = randomUUID();
    const receipt = input.receipt ?? id.replaceAll('-', '').slice(0, 40);

    try {
      return await withUserContext(
        this.getPool(),
        this.getSafeUserContext(user),
        async (client) => {
          const result = await client.query(
            `INSERT INTO payments.razorpay_orders (
             id,
             environment,
             status,
             subject_type,
             subject_id,
             customer_name,
             customer_email,
             customer_contact,
             receipt,
             amount,
             currency,
             description,
             callback_url,
             notes
           )
           VALUES ($1, $2, 'initialized', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::JSONB)`,
            [
              id,
              input.environment,
              input.subject?.type ?? null,
              input.subject?.id ?? null,
              input.customerName ?? null,
              input.customerEmail ?? null,
              input.customerContact ?? null,
              receipt,
              input.amount,
              input.currency.toLowerCase(),
              input.description ?? null,
              input.callbackUrl ?? null,
              JSON.stringify(notes),
            ]
          );

          if (result.rowCount === 0) {
            throw new AppError(
              'Razorpay order was not initialized',
              500,
              ERROR_CODES.INTERNAL_ERROR
            );
          }

          return { id, receipt };
        }
      );
    } catch (error) {
      throw this.normalizeOrderInsertError(error);
    }
  }

  private async markOrderCreated(
    id: string,
    order: RazorpayOrder,
    notes: Record<string, string>
  ): Promise<RazorpayOrderResponse> {
    const result = await this.getPool().query(
      `UPDATE payments.razorpay_orders
       SET status = $2,
           order_id = $3,
           receipt = COALESCE($4, receipt),
           amount = $5,
           amount_paid = $6,
           amount_due = $7,
           currency = $8,
           attempts = $9,
           notes = $10,
           raw = $11,
           last_error = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${RAZORPAY_ORDER_COLUMNS}`,
      [
        id,
        this.mapRazorpayOrderStatus(order.status),
        order.id,
        order.receipt ?? null,
        order.amount,
        order.amount_paid ?? null,
        order.amount_due ?? null,
        order.currency.toLowerCase(),
        order.attempts ?? null,
        notes,
        order,
      ]
    );

    return this.normalizeOrderRow(this.requireOrderRow(result.rows[0]));
  }

  private async markOrderFailed(id: string, error: unknown): Promise<RazorpayOrderResponse | null> {
    const message = error instanceof Error ? error.message : String(error);
    const result = await this.getPool().query(
      `UPDATE payments.razorpay_orders
       SET status = 'failed',
           last_error = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${RAZORPAY_ORDER_COLUMNS}`,
      [id, message]
    );

    const row = result.rows[0] as RazorpayOrderRow | undefined;
    return row ? this.normalizeOrderRow(row) : null;
  }

  private async markOrderVerified(
    environment: RazorpayEnvironment,
    orderId: string,
    paymentId: string
  ): Promise<RazorpayOrderResponse> {
    const result = await this.getPool().query(
      `UPDATE payments.razorpay_orders
       SET status = CASE WHEN status = 'paid' THEN status ELSE 'attempted' END,
           verified_payment_id = $3,
           verified_at = NOW(),
           last_error = NULL,
           updated_at = NOW()
       WHERE environment = $1
         AND order_id = $2
       RETURNING ${RAZORPAY_ORDER_COLUMNS}`,
      [environment, orderId, paymentId]
    );

    const row = result.rows[0] as RazorpayOrderRow | undefined;
    if (!row) {
      throw new AppError(
        `Razorpay ${environment} order not found: ${orderId}`,
        404,
        ERROR_CODES.PAYMENT_NOT_FOUND
      );
    }

    return this.normalizeOrderRow(row);
  }

  private buildCreateOrderResponse(
    keyId: string,
    order: RazorpayOrderResponse,
    input: CreateRazorpayOrderRequest
  ): CreateRazorpayOrderResponse {
    if (!order.orderId) {
      throw new AppError('Razorpay order was not created', 500, ERROR_CODES.PAYMENT_CONFIG_INVALID);
    }

    const prefill: { name?: string; email?: string; contact?: string } = {};
    if (input.customerName) {
      prefill.name = input.customerName;
    }
    if (input.customerEmail) {
      prefill.email = input.customerEmail;
    }
    if (input.customerContact) {
      prefill.contact = input.customerContact;
    }

    return {
      order,
      checkoutOptions: {
        key: keyId,
        amount: order.amount,
        currency: order.currency.toUpperCase(),
        order_id: order.orderId,
        ...(input.description ? { description: input.description } : {}),
        ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
        prefill,
      },
    };
  }

  private buildNotes(
    notes: Record<string, string> | undefined,
    subject: CreateRazorpayOrderRequest['subject']
  ): Record<string, string> {
    const razorpayNotes = { ...(notes ?? {}) };
    if (subject) {
      addBillingSubjectToProviderAttributes(razorpayNotes, subject);
    }
    return razorpayNotes;
  }

  private getSafeUserContext(user: UserContext): UserContext {
    if (!ORDER_INSERT_ROLES.has(user.role)) {
      throw new AppError(
        'Razorpay order creation requires a user token',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS
      );
    }

    return user;
  }

  private mapRazorpayOrderStatus(status: RazorpayOrder['status']): RazorpayOrderStatus {
    switch (status) {
      case 'paid':
        return 'paid';
      case 'attempted':
        return 'attempted';
      default:
        return 'created';
    }
  }

  private normalizeOrderInsertError(error: unknown): Error {
    if (isPostgresPermissionError(error)) {
      return new AppError(
        'Razorpay order creation is not allowed by payments.razorpay_orders RLS policies',
        403,
        ERROR_CODES.AUTH_UNAUTHORIZED
      );
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  private normalizeOrderRow(row: RazorpayOrderRow): RazorpayOrderResponse {
    return {
      id: row.id,
      environment: row.environment,
      status: row.status,
      subjectType: row.subjectType ?? null,
      subjectId: row.subjectId ?? null,
      customerName: row.customerName ?? null,
      customerEmail: row.customerEmail ?? null,
      customerContact: row.customerContact ?? null,
      orderId: row.orderId ?? null,
      receipt: row.receipt ?? null,
      amount: Number(row.amount),
      amountPaid: row.amountPaid === null ? null : Number(row.amountPaid),
      amountDue: row.amountDue === null ? null : Number(row.amountDue),
      currency: row.currency,
      attempts: row.attempts === null ? null : Number(row.attempts),
      verifiedPaymentId: row.verifiedPaymentId ?? null,
      verifiedAt: toISOStringOrNull(row.verifiedAt),
      notes: row.notes ?? {},
      lastError: row.lastError ?? null,
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  private requireOrderRow(row: unknown): RazorpayOrderRow {
    if (!row) {
      throw new AppError('Razorpay order not found', 404, ERROR_CODES.PAYMENT_NOT_FOUND);
    }

    return row as RazorpayOrderRow;
  }
}
