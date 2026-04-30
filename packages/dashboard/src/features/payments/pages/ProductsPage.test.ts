import { describe, expect, it } from 'vitest';
import type { StripePriceMirror } from '@insforge/shared-schemas';
import { formatAmount } from './ProductsPage';

const basePrice: StripePriceMirror = {
  environment: 'test',
  stripePriceId: 'price_123',
  stripeProductId: 'prod_123',
  active: true,
  currency: 'usd',
  unitAmount: 2000,
  unitAmountDecimal: null,
  type: 'one_time',
  lookupKey: null,
  billingScheme: null,
  taxBehavior: null,
  recurringInterval: null,
  recurringIntervalCount: null,
  metadata: {},
  syncedAt: '2026-04-30T00:00:00.000Z',
};

describe('formatAmount', () => {
  it('formats two-decimal currencies using minor units', () => {
    expect(formatAmount(basePrice)).toBe(
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        currencyDisplay: 'code',
      }).format(20)
    );
  });

  it('formats zero-decimal currencies without dividing by 100', () => {
    expect(
      formatAmount({
        ...basePrice,
        currency: 'jpy',
        unitAmount: 500,
      })
    ).toBe(
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'JPY',
        currencyDisplay: 'code',
      }).format(500)
    );
  });
});
