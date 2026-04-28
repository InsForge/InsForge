import { describe, expect, it } from 'vitest';
import {
  listPaymentCatalogRequestSchema,
  syncPaymentsRequestSchema,
  upsertPaymentsConfigRequestSchema,
} from '@insforge/shared-schemas';

describe('payments route schemas', () => {
  it('accepts test, live, and all sync targets', () => {
    expect(syncPaymentsRequestSchema.parse({ environment: 'test' })).toEqual({
      environment: 'test',
    });
    expect(syncPaymentsRequestSchema.parse({ environment: 'live' })).toEqual({
      environment: 'live',
    });
    expect(syncPaymentsRequestSchema.parse({ environment: 'all' })).toEqual({
      environment: 'all',
    });
  });

  it('defaults sync to all environments', () => {
    expect(syncPaymentsRequestSchema.parse({})).toEqual({ environment: 'all' });
  });

  it('rejects unknown sync environments', () => {
    expect(() => syncPaymentsRequestSchema.parse({ environment: 'prod' })).toThrow();
  });

  it('accepts optional catalog environment filters', () => {
    expect(listPaymentCatalogRequestSchema.parse({})).toEqual({});
    expect(listPaymentCatalogRequestSchema.parse({ environment: 'test' })).toEqual({
      environment: 'test',
    });
  });

  it('accepts Stripe key configuration requests', () => {
    expect(
      upsertPaymentsConfigRequestSchema.parse({
        environment: 'live',
        secretKey: 'sk_live_1234567890',
      })
    ).toEqual({
      environment: 'live',
      secretKey: 'sk_live_1234567890',
    });
  });

  it('rejects Stripe key configuration requests without a key', () => {
    expect(() =>
      upsertPaymentsConfigRequestSchema.parse({ environment: 'test', secretKey: '' })
    ).toThrow();
  });
});
