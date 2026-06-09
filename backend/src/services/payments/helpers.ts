import { toISOString, toISOStringOrNull } from '@/utils/dates.js';
import { AppError } from '@/utils/errors.js';
import type {
  PaymentTransactionRow,
  StripePriceRow,
  StripeProductRow,
  StripeEnvironment,
  StripePrice,
  StripeProduct,
} from '@/types/payments.js';
import {
  ERROR_CODES,
  paymentEnvironmentParamsSchema,
  type PaymentEnvironment,
  BillingSubject,
  PaymentTransaction,
  StripePrice as StripePriceResponse,
  StripeProduct as StripeProductResponse,
} from '@insforge/shared-schemas';

const BILLING_SUBJECT_METADATA_KEYS = {
  type: 'insforge_subject_type',
  id: 'insforge_subject_id',
} as const;

export type StripeIdempotencyOperation = 'checkout_session' | 'customer' | 'product' | 'price';

function formatPaymentValidationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
}

export function getPaymentEnvironment(params: unknown): PaymentEnvironment {
  const environment =
    typeof params === 'object' && params !== null && 'environment' in params
      ? { environment: params.environment }
      : params;

  const validation = paymentEnvironmentParamsSchema.safeParse(environment);
  if (!validation.success) {
    throw new AppError(
      formatPaymentValidationIssues(validation.error),
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }

  return validation.data.environment;
}

export function getBillingSubjectFromMetadata(
  metadata: Record<string, string> | null | undefined
): BillingSubject | null {
  const subjectType = metadata?.[BILLING_SUBJECT_METADATA_KEYS.type];
  const subjectId = metadata?.[BILLING_SUBJECT_METADATA_KEYS.id];

  if (!subjectType || !subjectId) {
    return null;
  }

  return { type: subjectType, id: subjectId };
}

export function addBillingSubjectToMetadata(
  metadata: Record<string, string>,
  subject: BillingSubject
): void {
  metadata[BILLING_SUBJECT_METADATA_KEYS.type] = subject.type;
  metadata[BILLING_SUBJECT_METADATA_KEYS.id] = subject.id;
}

export function getStripeObjectId(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id;
  }

  return null;
}

export function normalizeStripeDecimal(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const stringValue = String(value);

  try {
    const parsed = JSON.parse(stringValue) as unknown;
    if (typeof parsed === 'string') {
      return parsed;
    }
  } catch {
    // Decimal values are usually plain strings; only legacy mirrored rows need JSON unwrapping.
  }

  return stringValue;
}

export function fromStripeTimestamp(value: number | null | undefined): Date | null {
  return value ? new Date(value * 1000) : null;
}

export function buildStripeIdempotencyKey(
  environment: StripeEnvironment,
  operation: StripeIdempotencyOperation,
  callerKey: string | undefined
): string | undefined {
  if (!callerKey) {
    return undefined;
  }

  return `insforge:${environment}:${operation}:${callerKey}`;
}

export function normalizeProductRow(row: StripeProductRow): StripeProductResponse {
  return {
    ...row,
    syncedAt: toISOString(row.syncedAt),
  };
}

export function normalizeStripeProduct(
  product: StripeProduct,
  environment: StripeEnvironment
): StripeProductResponse {
  return {
    environment,
    productId: product.id,
    name: product.name,
    description: product.description ?? null,
    active: product.active,
    defaultPriceId: getStripeObjectId(product.default_price),
    metadata: product.metadata ?? {},
    syncedAt: new Date().toISOString(),
  };
}

export function normalizePriceRow(row: StripePriceRow): StripePriceResponse {
  return {
    ...row,
    unitAmount: row.unitAmount === null ? null : Number(row.unitAmount),
    unitAmountDecimal: normalizeStripeDecimal(row.unitAmountDecimal),
    syncedAt: toISOString(row.syncedAt),
  };
}

export function normalizePaymentTransactionRow(row: PaymentTransactionRow): PaymentTransaction {
  return {
    environment: row.environment,
    provider: row.provider,
    type: row.type,
    status: row.status,
    subjectType: row.subjectType ?? null,
    subjectId: row.subjectId ?? null,
    providerCustomerId: row.providerCustomerId ?? null,
    customerEmailSnapshot: row.customerEmailSnapshot ?? null,
    providerReferenceId: row.providerReferenceId ?? null,
    providerReferenceType: row.providerReferenceType ?? null,
    amount: row.amount === null ? null : Number(row.amount),
    amountRefunded: row.amountRefunded === null ? null : Number(row.amountRefunded),
    currency: row.currency ?? null,
    description: row.description ?? null,
    paidAt: toISOStringOrNull(row.paidAt),
    failedAt: toISOStringOrNull(row.failedAt),
    refundedAt: toISOStringOrNull(row.refundedAt),
    providerCreatedAt: toISOStringOrNull(row.providerCreatedAt),
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
  };
}

export function normalizeStripePrice(
  price: StripePrice,
  environment: StripeEnvironment
): StripePriceResponse {
  return {
    environment,
    priceId: price.id,
    productId: getStripeObjectId(price.product),
    active: price.active,
    currency: price.currency,
    unitAmount: price.unit_amount ?? null,
    unitAmountDecimal: normalizeStripeDecimal(price.unit_amount_decimal),
    type: price.type,
    lookupKey: price.lookup_key ?? null,
    billingScheme: price.billing_scheme ?? null,
    taxBehavior: price.tax_behavior ?? null,
    recurringInterval: price.recurring?.interval ?? null,
    recurringIntervalCount: price.recurring?.interval_count ?? null,
    metadata: price.metadata ?? {},
    syncedAt: new Date().toISOString(),
  };
}
