import { describe, expect, it, vi } from 'vitest';
import {
  maskStripeKey,
  StripeProvider,
  validateStripeSecretKey,
} from '../../src/providers/payments/stripe.provider';
import type { StripeClient, StripePrice } from '../../src/types/payments';

function createAsyncList<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

describe('StripeProvider', () => {
  it('rejects keys with the wrong environment prefix', () => {
    expect(() => validateStripeSecretKey('test', 'sk_live_wrong')).toThrow(
      /must start with sk_test_/i
    );
  });

  it('masks configured keys for logs and API responses', () => {
    expect(maskStripeKey('sk_test_abcdefghijklmnopqrstuvwxyz')).toBe('sk_test_****wxyz');
  });

  it('syncs account, products, and prices as one catalog snapshot', async () => {
    const client = {
      accounts: { retrieveCurrent: vi.fn().mockResolvedValue({ id: 'acct_123' }) },
      products: {
        list: vi.fn().mockReturnValue(createAsyncList([{ id: 'prod_123', object: 'product' }])),
      },
      prices: {
        list: vi
          .fn()
          .mockReturnValueOnce(createAsyncList([{ id: 'price_123', object: 'price' }]))
          .mockReturnValueOnce(createAsyncList([])),
      },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    await expect(provider.syncCatalog()).resolves.toMatchObject({
      account: { id: 'acct_123' },
      products: [{ id: 'prod_123' }],
      prices: [{ id: 'price_123' }],
    });
  });

  it('lists active and inactive prices so disabled prices remain visible', async () => {
    const client = {
      accounts: { retrieveCurrent: vi.fn() },
      products: { list: vi.fn() },
      prices: {
        list: vi
          .fn()
          .mockReturnValueOnce(
            createAsyncList([{ id: 'price_active', object: 'price', active: true }])
          )
          .mockReturnValueOnce(
            createAsyncList([{ id: 'price_inactive', object: 'price', active: false }])
          ),
      },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    const prices = await provider.listPrices();

    expect(prices.map((price: StripePrice) => price.id)).toEqual([
      'price_active',
      'price_inactive',
    ]);
  });
});
