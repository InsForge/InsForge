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

  it('creates, updates, and deletes products through Stripe products API', async () => {
    const client = {
      accounts: { retrieveCurrent: vi.fn() },
      products: {
        list: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'prod_new', object: 'product' }),
        update: vi.fn().mockResolvedValue({ id: 'prod_new', object: 'product' }),
        del: vi.fn().mockResolvedValue({ id: 'prod_new', deleted: true }),
      },
      prices: { list: vi.fn() },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    await provider.createProduct({
      name: 'Pro',
      description: null,
      active: true,
      metadata: { tier: 'pro' },
    });
    await provider.updateProduct('prod_new', {
      description: null,
      active: false,
    });
    await expect(provider.deleteProduct('prod_new')).resolves.toEqual({
      id: 'prod_new',
      deleted: true,
    });

    expect(client.products.create).toHaveBeenCalledWith({
      name: 'Pro',
      active: true,
      metadata: { tier: 'pro' },
    });
    expect(client.products.update).toHaveBeenCalledWith('prod_new', {
      description: '',
      active: false,
    });
    expect(client.products.del).toHaveBeenCalledWith('prod_new');
  });

  it('creates and updates prices through Stripe prices API', async () => {
    const client = {
      accounts: { retrieveCurrent: vi.fn() },
      products: { list: vi.fn() },
      prices: {
        list: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'price_new', object: 'price' }),
        update: vi.fn().mockResolvedValue({ id: 'price_new', object: 'price' }),
      },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    await provider.createPrice({
      stripeProductId: 'prod_123',
      currency: 'usd',
      unitAmount: 2000,
      lookupKey: 'pro_monthly',
      active: true,
      recurring: { interval: 'month', intervalCount: 1 },
      taxBehavior: 'exclusive',
      metadata: { tier: 'pro' },
    });
    await provider.updatePrice('price_new', {
      active: false,
      lookupKey: null,
      metadata: { archived: 'true' },
    });

    expect(client.prices.create).toHaveBeenCalledWith({
      product: 'prod_123',
      currency: 'usd',
      unit_amount: 2000,
      lookup_key: 'pro_monthly',
      active: true,
      recurring: { interval: 'month', interval_count: 1 },
      tax_behavior: 'exclusive',
      metadata: { tier: 'pro' },
    });
    expect(client.prices.update).toHaveBeenCalledWith('price_new', {
      active: false,
      lookup_key: '',
      metadata: { archived: 'true' },
    });
  });
});
