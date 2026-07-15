import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError } from '@/utils/errors.js';
import type { UserContext } from '@/api/middlewares/auth.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { PaystackConfigService } from '@/services/payments/paystack/config.service.js';
import {
  addBillingSubjectToProviderAttributes,
  isPostgresPermissionError,
  isPostgresUniqueViolationError,
} from '@/services/payments/helpers.js';
import { withUserContext } from '@/services/database/user-context.service.js';
import { toISOString, toISOStringOrNull } from '@/utils/dates.js';
import logger from '@/utils/logger.js';
import type {
  PaystackEnvironment,
  PaystackTransactionRow,
  PaystackTransactionStatus,
} from '@/types/payments.js';
import type {
  NormalizedPaystackRefund,
  PaystackInitializeResult,
  PaystackRefundResource,
  PaystackTransactionResource,
} from '@/providers/payments/paystack.provider.js';
import {
  ERROR_CODES,
  type BillingSubject,
  type InitializePaystackTransactionBody,
  type InitializePaystackTransactionResponse,
  type PaystackTransaction as PaystackTransactionResponse,
  type RoleSchema,
  type VerifyPaystackTransactionResponse,
} from '@insforge/shared-schemas';

const PAYSTACK_TRANSACTION_METADATA_KEY = 'insforge_transaction_id';

const PAYSTACK_TRANSACTION_REFERENCE_UNIQUE_INDEX =
  'idx_payments_paystack_transactions_environment_reference';

const PAYSTACK_TRANSACTION_COLUMNS = `
  id,
  environment,
  status,
  subject_type AS "subjectType",
  subject_id AS "subjectId",
  customer_email AS "customerEmail",
  reference,
  access_code AS "accessCode",
  authorization_url AS "authorizationUrl",
  amount,
  currency,
  verified_transaction_id AS "verifiedTransactionId",
  verified_at AS "verifiedAt",
  metadata,
  last_error AS "lastError",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const TRANSACTION_INSERT_ROLES = new Set<RoleSchema>(['anon', 'authenticated', 'project_admin']);

/** Status projected into the shared payments.transactions ledger. */
export type PaystackPaymentTransactionStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

type PaystackTransactionType = 'one_time_payment' | 'failed_payment' | 'refund';

interface TransactionObjectRef {
  type: string;
  id: string | null;
}

interface UpsertPaystackTransactionInput {
  environment: PaystackEnvironment;
  type: PaystackTransactionType;
  status: PaystackPaymentTransactionStatus;
  subject: BillingSubject | null;
  providerCustomerId: string | null;
  customerEmailSnapshot: string | null;
  providerObjectType: string;
  providerObjectId: string;
  providerParentObjectType?: string | null;
  providerParentObjectId?: string | null;
  relatedObjectIds: Record<string, string | null | undefined>;
  amount: number | null;
  amountRefunded?: number | null;
  currency: string | null;
  description: string | null;
  paidAt: Date | null;
  failedAt: Date | null;
  refundedAt: Date | null;
  providerCreatedAt: Date | null;
  raw: unknown;
  matchObjectRefs?: TransactionObjectRef[];
}

interface UpsertPaystackChargeOptions {
  subjectFallback?: BillingSubject | null;
  customerEmailFallback?: string | null;
}

export class PaystackTransactionService {
  private static instance: PaystackTransactionService;
  private pool: Pool | null = null;
  private readonly configService = PaystackConfigService.getInstance();

  static getInstance(): PaystackTransactionService {
    if (!PaystackTransactionService.instance) {
      PaystackTransactionService.instance = new PaystackTransactionService();
    }

    return PaystackTransactionService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }

    return this.pool;
  }

  async initializeTransaction(
    environment: PaystackEnvironment,
    input: InitializePaystackTransactionBody,
    user: UserContext
  ): Promise<InitializePaystackTransactionResponse> {
    const metadata = this.buildMetadata(input.metadata, input.subject);
    const initialized = await this.insertInitializedTransaction(environment, input, metadata, user);
    const providerMetadata = {
      ...metadata,
      [PAYSTACK_TRANSACTION_METADATA_KEY]: initialized.id,
    };

    try {
      const provider = await this.configService.createPaystackProvider(environment);
      const result = await provider.initializeTransaction({
        amount: input.amount,
        currency: input.currency,
        email: input.email,
        reference: input.reference ?? null,
        callbackUrl: input.callbackUrl ?? null,
        metadata: providerMetadata,
      });
      const storedTransaction = await this.markTransactionPending(
        initialized.id,
        result,
        providerMetadata
      );
      const publicKey = await this.configService.getPaystackPublicKey(environment);
      return this.buildInitializeResponse(publicKey, storedTransaction);
    } catch (error) {
      await this.markTransactionFailed(initialized.id, error).catch((markError) => {
        logger.warn('Failed to mark Paystack transaction as failed', {
          environment,
          transactionRecordId: initialized.id,
          error: markError instanceof Error ? markError.message : String(markError),
        });
      });
      throw error;
    }
  }

  async verifyTransaction(
    environment: PaystackEnvironment,
    reference: string,
    user: UserContext,
    claimedTransactionId?: string
  ): Promise<VerifyPaystackTransactionResponse> {
    // Paystack references leak through callback URLs and receipts, and unlike
    // Razorpay's verify there is no client-held signature proving involvement,
    // so bind verification to the transaction's owner before touching the
    // provider or mutating any row. Mismatches 404 to avoid confirming that a
    // guessed reference exists.
    const localRow = await this.assertVerifiableBy(
      environment,
      reference,
      user,
      claimedTransactionId
    );

    const provider = await this.configService.createPaystackProvider(environment);
    const transaction = await provider.verifyTransaction(reference);

    // Bind the provider's transaction back to the local session: initialize
    // stamps the local row id into the Paystack metadata, so a reference that
    // belongs to a payment created outside this project (or by another row)
    // will not echo this row's id. Without this check, a row initialized with
    // a foreign reference (the provider rejects it as a duplicate but the row
    // retains it) could claim someone else's real payment into the ledger.
    const providerMetadata = this.normalizeMetadata(transaction.metadata);
    if (providerMetadata[PAYSTACK_TRANSACTION_METADATA_KEY] !== localRow.id) {
      throw new AppError(
        `Paystack ${environment} transaction not found: ${reference}`,
        404,
        ERROR_CODES.PAYMENT_NOT_FOUND
      );
    }

    const status = this.mapPaystackTransactionStatus(transaction.status);
    const verified = status === 'success';

    const row = await this.markTransactionVerified(
      environment,
      reference,
      transaction,
      status,
      verified
    );
    await this.upsertChargeTransaction(environment, transaction, {
      subjectFallback:
        row.subjectType && row.subjectId ? { type: row.subjectType, id: row.subjectId } : null,
      customerEmailFallback: row.customerEmail,
    });

    return { verified, transaction: row };
  }

  /**
   * Project a Paystack transaction (from verify or a charge.success webhook)
   * into the shared payments.transactions ledger with provider = 'paystack'.
   */
  async upsertChargeTransaction(
    environment: PaystackEnvironment,
    transaction: PaystackTransactionResource,
    options: UpsertPaystackChargeOptions = {}
  ): Promise<PaystackPaymentTransactionStatus> {
    return this.upsertChargeWithClient(this.getPool(), environment, transaction, options);
  }

  private async upsertChargeWithClient(
    client: Pool | PoolClient,
    environment: PaystackEnvironment,
    transaction: PaystackTransactionResource,
    options: UpsertPaystackChargeOptions = {}
  ): Promise<PaystackPaymentTransactionStatus> {
    const status = this.mapChargeTransactionStatus(transaction.status);
    const metadata = this.normalizeMetadata(transaction.metadata);
    // Subject attribution must come from the bound local row (directly via
    // the caller's fallback, or looked up by the bound local id) — never from
    // the charge's own metadata. A signed charge proves account authenticity,
    // not row ownership: unbound charges carrying insforge_subject_* keys
    // must not attribute the ledger row to that subject.
    const subject =
      options.subjectFallback ??
      (await this.resolveSubjectFromTransactionRow(
        client,
        environment,
        transaction.reference,
        metadata[PAYSTACK_TRANSACTION_METADATA_KEY] ?? null
      ));
    const type = status === 'failed' ? 'failed_payment' : 'one_time_payment';
    const transactionId = this.toSafeProviderId(transaction.id);

    await this.upsertTransaction(client, {
      environment,
      type,
      status,
      subject,
      providerCustomerId: transaction.customer?.customer_code ?? null,
      customerEmailSnapshot: transaction.customer?.email ?? options.customerEmailFallback ?? null,
      providerObjectType: 'transaction',
      // The reference is the durable identity: numeric ids above
      // Number.MAX_SAFE_INTEGER arrive rounded from JSON.parse.
      providerObjectId: transactionId ?? transaction.reference,
      relatedObjectIds: {
        transaction: transactionId,
        reference: transaction.reference,
      },
      amount: transaction.amount,
      // Paystack reports a fully reversed charge (refund or chargeback) via
      // status alone; the transaction resource carries no refunded amount.
      amountRefunded: status === 'refunded' ? transaction.amount : 0,
      currency: transaction.currency.toLowerCase(),
      description: null,
      paidAt:
        status === 'succeeded'
          ? (this.fromPaystackTimestamp(transaction.paid_at) ??
            this.fromPaystackTimestamp(transaction.created_at))
          : null,
      failedAt: status === 'failed' ? this.fromPaystackTimestamp(transaction.created_at) : null,
      refundedAt:
        status === 'refunded'
          ? (this.fromPaystackTimestamp(transaction.paid_at) ??
            this.fromPaystackTimestamp(transaction.created_at))
          : null,
      providerCreatedAt: this.fromPaystackTimestamp(transaction.created_at),
      raw: transaction,
      matchObjectRefs: [
        { type: 'transaction', id: transactionId },
        { type: 'reference', id: transaction.reference },
      ],
    });

    return status;
  }

  /**
   * Project a Paystack refund (from a refund.processed / refund.failed webhook)
   * into the shared payments.transactions ledger and refresh the original
   * charge's refunded state, mirroring Razorpay's upsertRefundTransaction.
   */
  async upsertRefundTransaction(
    environment: PaystackEnvironment,
    refund: NormalizedPaystackRefund,
    status: PaystackPaymentTransactionStatus
  ): Promise<void> {
    const refundId = refund.id;
    const transactionId = this.getRefundOriginTransactionId(refund);
    const transactionReference = this.getRefundOriginTransactionReference(refund);

    await this.upsertTransaction(this.getPool(), {
      environment,
      type: 'refund',
      status,
      subject: null,
      providerCustomerId: null,
      customerEmailSnapshot: null,
      providerObjectType: 'refund',
      providerObjectId: refundId,
      providerParentObjectType: transactionId ? 'transaction' : null,
      providerParentObjectId: transactionId,
      relatedObjectIds: {
        refund: refundId,
        transaction: transactionId,
        reference: transactionReference,
      },
      amount: refund.amount,
      amountRefunded: refund.amount,
      currency: refund.currency.toLowerCase(),
      description: null,
      paidAt: null,
      failedAt: status === 'failed' ? this.fromPaystackTimestamp(refund.created_at) : null,
      refundedAt:
        status === 'refunded'
          ? (this.fromPaystackTimestamp(refund.refunded_at) ??
            this.fromPaystackTimestamp(refund.created_at))
          : null,
      providerCreatedAt: this.fromPaystackTimestamp(refund.created_at),
      raw: refund,
      matchObjectRefs: [{ type: 'refund', id: refundId }],
    });

    await this.refreshOriginalChargeRefundState(environment, transactionId, transactionReference);
  }

  private async upsertTransaction(
    client: Pool | PoolClient,
    input: UpsertPaystackTransactionInput
  ): Promise<void> {
    const relatedObjectIds = this.compactRelatedObjectIds(input.relatedObjectIds);
    const refs = this.compactObjectRefs([
      { type: input.providerObjectType, id: input.providerObjectId },
      ...(input.matchObjectRefs ?? []),
    ]);

    await client.query(
      `WITH refs AS (
         SELECT type, id
         FROM jsonb_to_recordset($22::JSONB) AS ref(type TEXT, id TEXT)
       ),
       matched AS (
         SELECT tx.id
         FROM payments.transactions AS tx
         WHERE tx.provider = 'paystack'
           AND tx.environment = $1
           AND ($6 = 'refund' OR tx.type <> 'refund')
           AND EXISTS (
             SELECT 1
             FROM refs
             WHERE refs.id IS NOT NULL
               AND (
                 (tx.provider_object_type = refs.type AND tx.provider_object_id = refs.id)
                 OR tx.related_object_ids->>refs.type = refs.id
               )
           )
         ORDER BY
          CASE WHEN tx.provider_object_type = $2 AND tx.provider_object_id = $3 THEN 0 ELSE 1 END,
          tx.created_at DESC
         LIMIT 1
       ),
       updated AS (
         UPDATE payments.transactions AS tx
         SET type = $6,
             status = CASE
               WHEN tx.status IN ('succeeded', 'failed', 'refunded', 'partially_refunded')
                 AND $7 = 'pending'
                 THEN tx.status
               ELSE $7
             END,
             subject_type = COALESCE($8, tx.subject_type),
             subject_id = COALESCE($9, tx.subject_id),
             provider_customer_id = COALESCE($10, tx.provider_customer_id),
             customer_email_snapshot = COALESCE($11, tx.customer_email_snapshot),
             provider_object_type = $2,
             provider_object_id = $3,
             provider_parent_object_type = COALESCE($4, tx.provider_parent_object_type),
             provider_parent_object_id = COALESCE($5, tx.provider_parent_object_id),
             related_object_ids = tx.related_object_ids || $12::JSONB,
             amount = $13,
             amount_refunded = COALESCE($14, tx.amount_refunded, 0),
             currency = $15,
             description = COALESCE($16, tx.description),
             paid_at = COALESCE($17, tx.paid_at),
             failed_at = COALESCE($18, tx.failed_at),
             refunded_at = COALESCE($19, tx.refunded_at),
             provider_created_at = COALESCE($20, tx.provider_created_at),
             raw = $21,
             updated_at = NOW()
         FROM matched
         WHERE tx.id = matched.id
         RETURNING tx.id
       )
       INSERT INTO payments.transactions AS tx (
         provider,
         environment,
         provider_object_type,
         provider_object_id,
         provider_parent_object_type,
         provider_parent_object_id,
         type,
         status,
         subject_type,
         subject_id,
         provider_customer_id,
         customer_email_snapshot,
         related_object_ids,
         amount,
         amount_refunded,
         currency,
         description,
         paid_at,
         failed_at,
         refunded_at,
         provider_created_at,
         raw
       )
       SELECT
         'paystack',
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11,
         $12::JSONB,
         $13,
         COALESCE($14, 0),
         $15,
         $16,
         $17,
         $18,
         $19,
         $20,
         $21
       WHERE NOT EXISTS (SELECT 1 FROM updated)
       ON CONFLICT (provider, environment, provider_object_type, provider_object_id)
         WHERE provider_object_type IS NOT NULL
           AND provider_object_id IS NOT NULL
       DO UPDATE SET
         type = EXCLUDED.type,
         status = CASE
           WHEN tx.status IN ('succeeded', 'failed', 'refunded', 'partially_refunded')
             AND EXCLUDED.status = 'pending'
             THEN tx.status
           ELSE EXCLUDED.status
         END,
         subject_type = COALESCE(EXCLUDED.subject_type, tx.subject_type),
         subject_id = COALESCE(EXCLUDED.subject_id, tx.subject_id),
         provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, tx.provider_customer_id),
         customer_email_snapshot = COALESCE(EXCLUDED.customer_email_snapshot, tx.customer_email_snapshot),
         provider_parent_object_type = COALESCE(EXCLUDED.provider_parent_object_type, tx.provider_parent_object_type),
         provider_parent_object_id = COALESCE(EXCLUDED.provider_parent_object_id, tx.provider_parent_object_id),
         related_object_ids = tx.related_object_ids || EXCLUDED.related_object_ids,
         amount = EXCLUDED.amount,
         amount_refunded = EXCLUDED.amount_refunded,
         currency = EXCLUDED.currency,
         description = COALESCE(EXCLUDED.description, tx.description),
         paid_at = COALESCE(EXCLUDED.paid_at, tx.paid_at),
         failed_at = COALESCE(EXCLUDED.failed_at, tx.failed_at),
         refunded_at = COALESCE(EXCLUDED.refunded_at, tx.refunded_at),
         provider_created_at = COALESCE(EXCLUDED.provider_created_at, tx.provider_created_at),
         raw = EXCLUDED.raw,
         updated_at = NOW()`,
      [
        input.environment,
        input.providerObjectType,
        input.providerObjectId,
        input.providerParentObjectType ?? null,
        input.providerParentObjectId ?? null,
        input.type,
        input.status,
        input.subject?.type ?? null,
        input.subject?.id ?? null,
        input.providerCustomerId,
        input.customerEmailSnapshot,
        JSON.stringify(relatedObjectIds),
        input.amount,
        input.amountRefunded ?? null,
        input.currency,
        input.description,
        input.paidAt,
        input.failedAt,
        input.refundedAt,
        input.providerCreatedAt,
        input.raw,
        JSON.stringify(refs),
      ]
    );
  }

  private async insertInitializedTransaction(
    environment: PaystackEnvironment,
    input: InitializePaystackTransactionBody,
    metadata: Record<string, string>,
    user: UserContext
  ): Promise<{ id: string }> {
    const id = randomUUID();

    try {
      return await withUserContext(
        this.getPool(),
        this.getSafeUserContext(user),
        async (client) => {
          const result = await client.query(
            `INSERT INTO payments.paystack_transactions (
             id,
             environment,
             status,
             subject_type,
             subject_id,
             customer_email,
             created_by,
             reference,
             amount,
             currency,
             callback_url,
             metadata
           )
           VALUES ($1, $2, 'initialized', $3, $4, $5, $6, $7, $8, $9, $10, $11::JSONB)`,
            [
              id,
              environment,
              input.subject?.type ?? null,
              input.subject?.id ?? null,
              input.email,
              // Only the authenticated UUID is a row-ownership identity; anon
              // and admin labels never reach uuid-typed columns.
              user.role === 'authenticated' ? user.id : null,
              input.reference ?? null,
              input.amount,
              input.currency.toLowerCase(),
              input.callbackUrl ?? null,
              JSON.stringify(metadata),
            ]
          );

          if (result.rowCount === 0) {
            throw new AppError(
              'Paystack transaction was not initialized',
              500,
              ERROR_CODES.INTERNAL_ERROR
            );
          }

          return { id };
        }
      );
    } catch (error) {
      throw this.normalizeTransactionInsertError(error);
    }
  }

  private async markTransactionPending(
    id: string,
    result: PaystackInitializeResult,
    metadata: Record<string, string>
  ): Promise<PaystackTransactionResponse> {
    const updateResult = await this.getPool().query(
      `UPDATE payments.paystack_transactions
       SET status = 'pending',
           reference = $2,
           access_code = $3,
           authorization_url = $4,
           metadata = $5,
           raw = $6,
           last_error = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${PAYSTACK_TRANSACTION_COLUMNS}`,
      [id, result.reference, result.access_code, result.authorization_url, metadata, result]
    );

    return this.normalizeTransactionRow(this.requireTransactionRow(updateResult.rows[0]));
  }

  private async markTransactionFailed(
    id: string,
    error: unknown
  ): Promise<PaystackTransactionResponse | null> {
    const message = error instanceof Error ? error.message : String(error);
    const result = await this.getPool().query(
      `UPDATE payments.paystack_transactions
       SET status = 'failed',
           last_error = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${PAYSTACK_TRANSACTION_COLUMNS}`,
      [id, message]
    );

    const row = result.rows[0] as PaystackTransactionRow | undefined;
    return row ? this.normalizeTransactionRow(row) : null;
  }

  /**
   * Verification is owner-bound: rows created by an authenticated user may
   * only be verified by that user (or a project admin); rows created through
   * anon flows carry no owning UUID, so the caller must instead present the
   * local transaction id — an unguessable UUID returned only by initialize —
   * as proof of being party to the checkout. Unknown references, ownership
   * mismatches, and missing/incorrect ids all 404 so a guessed reference is
   * never confirmed.
   */
  private async assertVerifiableBy(
    environment: PaystackEnvironment,
    reference: string,
    user: UserContext,
    claimedTransactionId?: string
  ): Promise<{ id: string }> {
    const result = await this.getPool().query<{ id: string; created_by: string | null }>(
      `SELECT id, created_by
       FROM payments.paystack_transactions
       WHERE environment = $1
         AND reference = $2`,
      [environment, reference]
    );

    const row = result.rows[0];
    const allowed =
      row !== undefined &&
      (user.role === 'project_admin' ||
        (row.created_by !== null
          ? user.role === 'authenticated' && user.id === row.created_by
          : claimedTransactionId === row.id));

    if (!allowed) {
      throw new AppError(
        `Paystack ${environment} transaction not found: ${reference}`,
        404,
        ERROR_CODES.PAYMENT_NOT_FOUND
      );
    }

    return { id: row.id };
  }

  private async markTransactionVerified(
    environment: PaystackEnvironment,
    reference: string,
    transaction: PaystackTransactionResource,
    status: PaystackTransactionStatus,
    verified: boolean
  ): Promise<PaystackTransactionResponse> {
    const result = await this.getPool().query(
      `UPDATE payments.paystack_transactions
       SET status = CASE
             WHEN status = 'reversed' THEN status
             WHEN status = 'success' AND $3 <> 'reversed' THEN status
             ELSE $3
           END,
           verified_transaction_id = COALESCE(verified_transaction_id, $4),
           verified_at = CASE WHEN $5 THEN COALESCE(verified_at, NOW()) ELSE verified_at END,
           raw = $6,
           last_error = NULL,
           updated_at = NOW()
       WHERE environment = $1
         AND reference = $2
       RETURNING ${PAYSTACK_TRANSACTION_COLUMNS}`,
      [environment, reference, status, this.toSafeProviderId(transaction.id), verified, transaction]
    );

    const row = result.rows[0] as PaystackTransactionRow | undefined;
    if (!row) {
      throw new AppError(
        `Paystack ${environment} transaction not found: ${reference}`,
        404,
        ERROR_CODES.PAYMENT_NOT_FOUND
      );
    }

    return this.normalizeTransactionRow(row);
  }

  private buildInitializeResponse(
    publicKey: string | null,
    transaction: PaystackTransactionResponse
  ): InitializePaystackTransactionResponse {
    if (!transaction.reference || !transaction.accessCode || !transaction.authorizationUrl) {
      throw new AppError(
        'Paystack transaction was not initialized',
        500,
        ERROR_CODES.PAYMENT_CONFIG_INVALID
      );
    }

    return {
      transaction,
      authorizationUrl: transaction.authorizationUrl,
      accessCode: transaction.accessCode,
      reference: transaction.reference,
      publicKey,
    };
  }

  private buildMetadata(
    metadata: Record<string, string> | undefined,
    subject: InitializePaystackTransactionBody['subject']
  ): Record<string, string> {
    const paystackMetadata = { ...(metadata ?? {}) };
    if (subject) {
      addBillingSubjectToProviderAttributes(paystackMetadata, subject);
    }
    return paystackMetadata;
  }

  /**
   * Resolve a billing subject from the local session row — but only from the
   * row the provider transaction is actually bound to. Requiring the row id
   * that initialize stamped into the charge's metadata prevents a row that
   * merely shares the reference (e.g. one initialized with a foreign
   * reference) from lending its subject to someone else's payment.
   */
  private async resolveSubjectFromTransactionRow(
    client: Pool | PoolClient,
    environment: PaystackEnvironment,
    reference: string | null,
    boundTransactionId: string | null
  ): Promise<BillingSubject | null> {
    if (!reference || !boundTransactionId) {
      return null;
    }

    const result = await client.query(
      `SELECT subject_type AS "type", subject_id AS "id"
       FROM payments.paystack_transactions
       WHERE environment = $1
         AND reference = $2
         AND id = $3
         AND subject_type IS NOT NULL
         AND subject_id IS NOT NULL
       LIMIT 1`,
      [environment, reference, boundTransactionId]
    );

    return (result.rows[0] as BillingSubject | undefined) ?? null;
  }

  private getRefundOriginTransactionId(refund: PaystackRefundResource): string | null {
    const { transaction } = refund;
    if (typeof transaction === 'number') {
      return this.toSafeProviderId(transaction);
    }
    if (this.isRecord(transaction)) {
      return this.toSafeProviderId(
        typeof transaction.id === 'number' || typeof transaction.id === 'string'
          ? transaction.id
          : null
      );
    }
    return null;
  }

  private getRefundOriginTransactionReference(refund: PaystackRefundResource): string | null {
    if (
      typeof refund.transaction_reference === 'string' &&
      refund.transaction_reference.length > 0
    ) {
      return refund.transaction_reference;
    }
    const { transaction } = refund;
    if (typeof transaction === 'string' && transaction.length > 0) {
      return transaction;
    }
    if (
      this.isRecord(transaction) &&
      typeof transaction.reference === 'string' &&
      transaction.reference.length > 0
    ) {
      return transaction.reference;
    }
    return null;
  }

  /**
   * Recompute the original charge's refunded amount/status from its refund
   * rows and backfill subject/customer context onto those refund rows. The
   * original charge is keyed by Paystack transaction id and/or reference —
   * refund webhooks may carry either.
   */
  private async refreshOriginalChargeRefundState(
    environment: PaystackEnvironment,
    transactionId: string | null,
    transactionReference: string | null
  ): Promise<void> {
    if (!transactionId && !transactionReference) {
      return;
    }

    await this.getPool().query(
      `WITH refund_totals AS (
         SELECT
           COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::BIGINT AS amount_refunded,
           MAX(refunded_at) FILTER (WHERE status = 'refunded') AS refunded_at
         FROM payments.transactions
         WHERE provider = 'paystack'
           AND environment = $1
           AND type = 'refund'
           AND (
             ($2::TEXT IS NOT NULL AND (
               (provider_parent_object_type = 'transaction' AND provider_parent_object_id = $2)
               OR related_object_ids->>'transaction' = $2
             ))
             OR ($3::TEXT IS NOT NULL AND related_object_ids->>'reference' = $3)
           )
       ),
       original_context AS (
         SELECT
           subject_type,
           subject_id,
           provider_customer_id,
           customer_email_snapshot,
           related_object_ids,
           description
         FROM payments.transactions
         WHERE provider = 'paystack'
           AND environment = $1
           AND type <> 'refund'
           AND (
             ($2::TEXT IS NOT NULL AND (
               (provider_object_type = 'transaction' AND provider_object_id = $2)
               OR related_object_ids->>'transaction' = $2
             ))
             OR ($3::TEXT IS NOT NULL AND related_object_ids->>'reference' = $3)
           )
         ORDER BY created_at DESC
         LIMIT 1
       ),
       updated_original AS (
         UPDATE payments.transactions original
         SET amount_refunded = refund_totals.amount_refunded,
             status = CASE
               WHEN refund_totals.amount_refunded > 0
                 AND original.amount IS NOT NULL
                 AND refund_totals.amount_refunded >= original.amount
                 THEN 'refunded'
               WHEN refund_totals.amount_refunded > 0
                 THEN 'partially_refunded'
               WHEN original.status IN ('refunded', 'partially_refunded')
                 THEN CASE WHEN original.failed_at IS NOT NULL THEN 'failed' ELSE 'succeeded' END
               ELSE original.status
             END,
             refunded_at = CASE
               WHEN refund_totals.amount_refunded > 0 THEN refund_totals.refunded_at
               ELSE NULL
             END,
             updated_at = NOW()
         FROM refund_totals
         WHERE original.provider = 'paystack'
           AND original.environment = $1
           AND original.type <> 'refund'
           AND (
             ($2::TEXT IS NOT NULL AND (
               (original.provider_object_type = 'transaction' AND original.provider_object_id = $2)
               OR original.related_object_ids->>'transaction' = $2
             ))
             OR ($3::TEXT IS NOT NULL AND original.related_object_ids->>'reference' = $3)
           )
         RETURNING original.id
       )
       UPDATE payments.transactions refund
       SET subject_type = COALESCE(refund.subject_type, original_context.subject_type),
           subject_id = COALESCE(refund.subject_id, original_context.subject_id),
           provider_customer_id = COALESCE(refund.provider_customer_id, original_context.provider_customer_id),
           customer_email_snapshot = COALESCE(refund.customer_email_snapshot, original_context.customer_email_snapshot),
           related_object_ids = original_context.related_object_ids || refund.related_object_ids,
           description = COALESCE(refund.description, original_context.description),
           updated_at = NOW()
       FROM original_context
       WHERE refund.provider = 'paystack'
         AND refund.environment = $1
         AND refund.type = 'refund'
         AND (
           ($2::TEXT IS NOT NULL AND (
             (refund.provider_parent_object_type = 'transaction' AND refund.provider_parent_object_id = $2)
             OR refund.related_object_ids->>'transaction' = $2
           ))
           OR ($3::TEXT IS NOT NULL AND refund.related_object_ids->>'reference' = $3)
         )`,
      [environment, transactionId, transactionReference]
    );
  }

  private getSafeUserContext(user: UserContext): UserContext {
    if (!TRANSACTION_INSERT_ROLES.has(user.role)) {
      throw new AppError(
        'Paystack transaction initialization requires a user token',
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS
      );
    }

    return user;
  }

  private mapPaystackTransactionStatus(
    status: PaystackTransactionResource['status']
  ): PaystackTransactionStatus {
    switch (status) {
      case 'success':
        return 'success';
      case 'failed':
        return 'failed';
      case 'abandoned':
        return 'abandoned';
      // Paystack marks a refunded transaction or successful chargeback as
      // `reversed` — a terminal state, never pending again.
      case 'reversed':
        return 'reversed';
      default:
        return 'pending';
    }
  }

  private mapChargeTransactionStatus(
    status: PaystackTransactionResource['status']
  ): PaystackPaymentTransactionStatus {
    switch (status) {
      case 'success':
        return 'succeeded';
      case 'failed':
        return 'failed';
      // A reversed charge is fully refunded (refund or chargeback); mapping
      // it to pending would be ignored by the ledger's terminal-state guard
      // and leave a succeeded payment succeeded forever.
      case 'reversed':
        return 'refunded';
      default:
        return 'pending';
    }
  }

  /**
   * Paystack ids are unsigned 64-bit; JSON.parse rounds values above
   * Number.MAX_SAFE_INTEGER and String() cannot recover the digits. Only
   * safe integers become provider-id strings — callers fall back to the
   * transaction reference as the durable identity.
   */
  private toSafeProviderId(id: number | string | null | undefined): string | null {
    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
    if (typeof id === 'number' && Number.isSafeInteger(id)) {
      return String(id);
    }
    return null;
  }

  /**
   * The local session row id a provider transaction claims to belong to
   * (stamped into Paystack metadata at initialize), or null when the
   * transaction was not created by this project.
   */
  extractBoundTransactionId(value: unknown): string | null {
    return this.normalizeMetadata(value)[PAYSTACK_TRANSACTION_METADATA_KEY] ?? null;
  }

  private normalizeMetadata(value: unknown): Record<string, string> {
    // Paystack echoes metadata back either as an object or a JSON-encoded string.
    const record = this.parseMetadataRecord(value);
    return Object.fromEntries(
      Object.entries(record)
        .filter(([, entryValue]) => {
          return (
            typeof entryValue === 'string' ||
            typeof entryValue === 'number' ||
            typeof entryValue === 'boolean'
          );
        })
        .map(([key, entryValue]) => [key, String(entryValue)])
    );
  }

  private parseMetadataRecord(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        return this.isRecord(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }

    return this.isRecord(value) ? value : {};
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private fromPaystackTimestamp(value: string | null | undefined): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private normalizeTransactionInsertError(error: unknown): Error {
    if (isPostgresPermissionError(error)) {
      return new AppError(
        'Paystack transaction initialization is not allowed by payments.paystack_transactions RLS policies',
        403,
        ERROR_CODES.AUTH_UNAUTHORIZED
      );
    }

    if (isPostgresUniqueViolationError(error, PAYSTACK_TRANSACTION_REFERENCE_UNIQUE_INDEX)) {
      return new AppError(
        'A Paystack transaction with this reference already exists in this environment',
        409,
        ERROR_CODES.PAYMENT_CHECKOUT_ALREADY_EXISTS
      );
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  private normalizeTransactionRow(row: PaystackTransactionRow): PaystackTransactionResponse {
    return {
      id: row.id,
      environment: row.environment,
      status: row.status,
      subjectType: row.subjectType ?? null,
      subjectId: row.subjectId ?? null,
      customerEmail: row.customerEmail ?? null,
      reference: row.reference ?? null,
      accessCode: row.accessCode ?? null,
      authorizationUrl: row.authorizationUrl ?? null,
      amount: Number(row.amount),
      currency: row.currency,
      verifiedTransactionId: row.verifiedTransactionId ?? null,
      verifiedAt: toISOStringOrNull(row.verifiedAt),
      metadata: row.metadata ?? {},
      lastError: row.lastError ?? null,
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt),
    };
  }

  private requireTransactionRow(row: unknown): PaystackTransactionRow {
    if (!row) {
      throw new AppError('Paystack transaction not found', 404, ERROR_CODES.PAYMENT_NOT_FOUND);
    }

    return row as PaystackTransactionRow;
  }

  private compactRelatedObjectIds(
    input: Record<string, string | null | undefined>
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(input).filter((entry): entry is [string, string] => {
        const [, value] = entry;
        return typeof value === 'string' && value.length > 0;
      })
    );
  }

  private compactObjectRefs(refs: TransactionObjectRef[]): Array<{ type: string; id: string }> {
    const seen = new Set<string>();
    const compacted: Array<{ type: string; id: string }> = [];

    for (const ref of refs) {
      if (!ref.id) {
        continue;
      }

      const key = `${ref.type}:${ref.id}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      compacted.push({ type: ref.type, id: ref.id });
    }

    return compacted;
  }
}
