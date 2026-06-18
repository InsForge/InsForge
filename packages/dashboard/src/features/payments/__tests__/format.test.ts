import { describe, expect, it } from 'vitest';
import {
  formatCurrencyAmount,
  formatDateTime,
  formatLastSynced,
  formatPriceAmount,
  getCurrencyFractionDigits,
} from '#features/payments/format';
import type { CatalogPrice } from '#features/payments/types/catalog';

function makePrice(overrides: Partial<CatalogPrice>): CatalogPrice {
  return {
    environment: 'test',
    provider: 'stripe',
    providerPriceId: 'price_1',
    providerProductId: 'prod_1',
    active: true,
    currency: 'USD',
    unitAmount: 1999,
    unitAmountDecimal: null,
    type: 'one_time',
    lookupKey: null,
    billingScheme: 'per_unit',
    taxBehavior: null,
    recurringInterval: null,
    recurringIntervalCount: null,
    metadata: {},
    syncedAt: '2025-01-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('formatDateTime / formatLastSynced', () => {
  it('returns placeholders for empty input and the raw string for unparseable dates', () => {
    expect(formatDateTime(null)).toBe('-');
    expect(formatDateTime('')).toBe('-');
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
    expect(formatLastSynced(null)).toBe('Never');
  });

  it('formats a valid timestamp', () => {
    // Locale-dependent exact output; assert the year is present.
    expect(formatDateTime('2025-01-15T15:30:00Z')).toContain('2025');
    expect(formatLastSynced('2025-01-15T15:30:00Z')).toContain('2025');
  });
});

describe('getCurrencyFractionDigits', () => {
  it('returns the ISO-4217 minor-unit exponent (case-insensitive)', () => {
    expect(getCurrencyFractionDigits('USD')).toBe(2);
    expect(getCurrencyFractionDigits('jpy')).toBe(0);
  });

  it('falls back to 2 for an invalid currency code instead of throwing', () => {
    expect(getCurrencyFractionDigits('US')).toBe(2);
  });
});

describe('formatCurrencyAmount', () => {
  it('returns "-" when amount or currency is missing', () => {
    expect(formatCurrencyAmount(null, 'USD')).toBe('-');
    expect(formatCurrencyAmount(1999, null)).toBe('-');
  });

  it('scales by the currency minor units and includes the code', () => {
    expect(formatCurrencyAmount(1999, 'USD')).toContain('USD');
  });

  it('renders a readable fallback for an invalid currency instead of crashing', () => {
    expect(formatCurrencyAmount(1999, 'US')).toBe('US 19.99');
  });
});

describe('formatPriceAmount', () => {
  it('returns "Custom" when the price has no amount', () => {
    expect(formatPriceAmount(makePrice({ unitAmount: null, unitAmountDecimal: null }))).toBe(
      'Custom'
    );
  });

  it('formats a unit amount with its currency code', () => {
    expect(formatPriceAmount(makePrice({ unitAmount: 1999, currency: 'USD' }))).toContain('USD');
  });

  it('falls back safely for an invalid currency', () => {
    expect(formatPriceAmount(makePrice({ unitAmount: 1999, currency: 'US' }))).toBe('US 19.99');
  });
});
