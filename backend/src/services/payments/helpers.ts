import { SUBJECT_METADATA_KEYS } from '@/services/payments/constants.js';
import type {
  StripeEnvironment,
  StripePrice,
  StripePriceRow,
  StripeProduct,
  StripeProductRow,
} from '@/types/payments.js';
import type {
  BillingSubject,
  StripePriceMirror,
  StripeProductMirror,
} from '@insforge/shared-schemas';

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

export function getBillingSubjectFromMetadata(
  metadata: Record<string, string> | null | undefined
): BillingSubject | null {
  const subjectType = metadata?.[SUBJECT_METADATA_KEYS.type];
  const subjectId = metadata?.[SUBJECT_METADATA_KEYS.id];

  if (!subjectType || !subjectId) {
    return null;
  }

  return { type: subjectType, id: subjectId };
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

export function toISOStringOrNull(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return toISOString(value);
}

export function toISOString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function fromStripeTimestamp(value: number | null | undefined): Date | null {
  return value ? new Date(value * 1000) : null;
}

export function normalizeProductRow(row: StripeProductRow): StripeProductMirror {
  return {
    ...row,
    syncedAt: toISOString(row.syncedAt),
  };
}

export function normalizeStripeProduct(
  product: StripeProduct,
  environment: StripeEnvironment
): StripeProductMirror {
  return {
    environment,
    stripeProductId: product.id,
    name: product.name,
    description: product.description ?? null,
    active: product.active,
    defaultPriceId: getStripeObjectId(product.default_price),
    metadata: product.metadata ?? {},
    syncedAt: new Date().toISOString(),
  };
}

export function normalizePriceRow(row: StripePriceRow): StripePriceMirror {
  return {
    ...row,
    unitAmount: row.unitAmount === null ? null : Number(row.unitAmount),
    unitAmountDecimal: normalizeStripeDecimal(row.unitAmountDecimal),
    syncedAt: toISOString(row.syncedAt),
  };
}

export function normalizeStripePrice(
  price: StripePrice,
  environment: StripeEnvironment
): StripePriceMirror {
  return {
    environment,
    stripePriceId: price.id,
    stripeProductId: getStripeObjectId(price.product),
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
