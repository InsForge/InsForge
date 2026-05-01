import { describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
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

  it('lists all Stripe subscriptions for bootstrap and repair imports', async () => {
    const client = {
      accounts: { retrieveCurrent: vi.fn() },
      products: { list: vi.fn() },
      prices: { list: vi.fn() },
      subscriptions: {
        list: vi.fn().mockReturnValue(createAsyncList([{ id: 'sub_123', object: 'subscription' }])),
      },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    await expect(provider.listSubscriptions()).resolves.toEqual([
      { id: 'sub_123', object: 'subscription' },
    ]);

    expect(client.subscriptions.list).toHaveBeenCalledWith({
      limit: 100,
      status: 'all',
    });
  });

  it('lists all Stripe subscription items for a subscription', async () => {
    const client = {
      accounts: { retrieveCurrent: vi.fn() },
      products: { list: vi.fn() },
      prices: { list: vi.fn() },
      subscriptions: { list: vi.fn() },
      subscriptionItems: {
        list: vi.fn().mockReturnValue(
          createAsyncList([
            { id: 'si_123', object: 'subscription_item', subscription: 'sub_123' },
            { id: 'si_456', object: 'subscription_item', subscription: 'sub_123' },
          ])
        ),
      },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    await expect(provider.listSubscriptionItems('sub_123')).resolves.toEqual([
      { id: 'si_123', object: 'subscription_item', subscription: 'sub_123' },
      { id: 'si_456', object: 'subscription_item', subscription: 'sub_123' },
    ]);

    expect(client.subscriptionItems.list).toHaveBeenCalledWith({
      limit: 100,
      subscription: 'sub_123',
    });
  });

  it('retrieves Stripe objects needed to recover refund context', async () => {
    const invoicePayment = {
      id: 'inpay_123',
      object: 'invoice_payment',
      invoice: {
        id: 'in_123',
        object: 'invoice',
      },
      payment: {
        type: 'payment_intent',
        payment_intent: 'pi_123',
      },
    };
    const client = {
      accounts: { retrieveCurrent: vi.fn() },
      products: { list: vi.fn() },
      prices: { list: vi.fn() },
      paymentIntents: {
        retrieve: vi.fn().mockResolvedValue({ id: 'pi_123', object: 'payment_intent' }),
      },
      charges: {
        retrieve: vi.fn().mockResolvedValue({ id: 'ch_123', object: 'charge' }),
      },
      invoicePayments: {
        list: vi.fn().mockReturnValue(createAsyncList([invoicePayment])),
      },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    await expect(provider.retrievePaymentIntent('pi_123')).resolves.toMatchObject({
      id: 'pi_123',
    });
    await expect(provider.retrieveCharge('ch_123')).resolves.toMatchObject({
      id: 'ch_123',
    });
    await expect(provider.retrieveInvoiceByPaymentIntent('pi_123')).resolves.toMatchObject({
      id: 'in_123',
      payments: {
        data: [expect.objectContaining({ id: 'inpay_123' })],
      },
    });

    expect(client.paymentIntents.retrieve).toHaveBeenCalledWith('pi_123');
    expect(client.charges.retrieve).toHaveBeenCalledWith('ch_123');
    expect(client.invoicePayments.list).toHaveBeenCalledWith({
      limit: 1,
      payment: {
        type: 'payment_intent',
        payment_intent: 'pi_123',
      },
      expand: ['data.invoice'],
    });
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

  it('creates customers through Stripe customers API', async () => {
    const client = {
      accounts: { retrieveCurrent: vi.fn() },
      products: { list: vi.fn() },
      prices: { list: vi.fn() },
      customers: {
        create: vi.fn().mockResolvedValue({ id: 'cus_123', object: 'customer' }),
      },
      checkout: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn() },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    await provider.createCustomer({
      email: 'buyer@example.com',
      metadata: { insforge_subject_type: 'team', insforge_subject_id: 'team_123' },
    });

    expect(client.customers.create).toHaveBeenCalledWith({
      email: 'buyer@example.com',
      metadata: { insforge_subject_type: 'team', insforge_subject_id: 'team_123' },
    });
  });

  it('creates customer portal sessions through Stripe billing portal API', async () => {
    const client = {
      accounts: { retrieveCurrent: vi.fn() },
      products: { list: vi.fn() },
      prices: { list: vi.fn() },
      customers: { create: vi.fn() },
      billingPortal: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: 'bps_123',
            object: 'billing_portal.session',
            url: 'https://billing.stripe.com/p/session/test_123',
          }),
        },
      },
      checkout: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn() },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    await provider.createCustomerPortalSession({
      customerId: 'cus_123',
      returnUrl: 'https://example.com/account',
      configuration: 'bpc_123',
    });

    expect(client.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_123',
      return_url: 'https://example.com/account',
      configuration: 'bpc_123',
    });
  });

  it('creates checkout sessions and copies metadata onto durable Stripe objects', async () => {
    const client = {
      accounts: { retrieveCurrent: vi.fn() },
      products: { list: vi.fn() },
      prices: { list: vi.fn() },
      customers: { create: vi.fn() },
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: 'cs_test_123',
            object: 'checkout.session',
            url: 'https://checkout.stripe.com/c/pay/cs_test_123',
          }),
        },
      },
      webhooks: { constructEvent: vi.fn() },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    await provider.createCheckoutSession({
      mode: 'subscription',
      lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      customerId: 'cus_123',
      metadata: { insforge_subject_type: 'team', insforge_subject_id: 'team_123' },
    });

    expect(client.checkout.sessions.create).toHaveBeenCalledWith({
      mode: 'subscription',
      line_items: [{ price: 'price_123', quantity: 1 }],
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
      metadata: { insforge_subject_type: 'team', insforge_subject_id: 'team_123' },
      customer: 'cus_123',
      subscription_data: {
        metadata: { insforge_subject_type: 'team', insforge_subject_id: 'team_123' },
      },
    });
  });

  it('requests Customer creation for identified one-time Checkout Sessions', async () => {
    const client = {
      accounts: { retrieveCurrent: vi.fn() },
      products: { list: vi.fn() },
      prices: { list: vi.fn() },
      customers: { create: vi.fn() },
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: 'cs_test_123',
            object: 'checkout.session',
            url: 'https://checkout.stripe.com/c/pay/cs_test_123',
          }),
        },
      },
      webhooks: { constructEvent: vi.fn() },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    await provider.createCheckoutSession({
      mode: 'payment',
      lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      customerEmail: 'buyer@example.com',
      customerCreation: 'always',
    });

    expect(client.checkout.sessions.create).toHaveBeenCalledWith({
      mode: 'payment',
      line_items: [{ price: 'price_123', quantity: 1 }],
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
      customer_email: 'buyer@example.com',
      customer_creation: 'always',
    });
  });

  it('passes idempotency keys to Stripe create requests', async () => {
    const client = {
      accounts: { retrieveCurrent: vi.fn() },
      products: {
        list: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'prod_new', object: 'product' }),
      },
      prices: {
        list: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'price_new', object: 'price' }),
      },
      customers: {
        create: vi.fn().mockResolvedValue({ id: 'cus_123', object: 'customer' }),
      },
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({ id: 'cs_test_123', object: 'checkout.session' }),
        },
      },
      webhooks: { constructEvent: vi.fn() },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    await provider.createCustomer({
      email: 'buyer@example.com',
      idempotencyKey: 'insforge:test:customer:checkout-123',
    });
    await provider.createCheckoutSession({
      mode: 'payment',
      lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      idempotencyKey: 'insforge:test:checkout_session:checkout-123',
    });
    await provider.createProduct({
      name: 'Pro',
      idempotencyKey: 'insforge:test:product:agent-123',
    });
    await provider.createPrice({
      stripeProductId: 'prod_123',
      currency: 'usd',
      unitAmount: 2000,
      idempotencyKey: 'insforge:test:price:agent-123',
    });

    expect(client.customers.create).toHaveBeenCalledWith(
      { email: 'buyer@example.com' },
      { idempotencyKey: 'insforge:test:customer:checkout-123' }
    );
    expect(client.checkout.sessions.create).toHaveBeenCalledWith(
      {
        mode: 'payment',
        line_items: [{ price: 'price_123', quantity: 1 }],
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      },
      { idempotencyKey: 'insforge:test:checkout_session:checkout-123' }
    );
    expect(client.products.create).toHaveBeenCalledWith(
      { name: 'Pro' },
      { idempotencyKey: 'insforge:test:product:agent-123' }
    );
    expect(client.prices.create).toHaveBeenCalledWith(
      {
        product: 'prod_123',
        currency: 'usd',
        unit_amount: 2000,
      },
      { idempotencyKey: 'insforge:test:price:agent-123' }
    );
  });

  it('constructs webhook events with the original raw body and Stripe signature', () => {
    const rawBody = Buffer.from('{"id":"evt_123"}');
    const client = {
      accounts: { retrieveCurrent: vi.fn() },
      products: { list: vi.fn() },
      prices: { list: vi.fn() },
      customers: { create: vi.fn() },
      checkout: { sessions: { create: vi.fn() } },
      webhooks: {
        constructEvent: vi
          .fn()
          .mockReturnValue({ id: 'evt_123', type: 'checkout.session.completed' }),
      },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    expect(provider.constructWebhookEvent(rawBody, 'sig_123', 'whsec_123')).toEqual({
      id: 'evt_123',
      type: 'checkout.session.completed',
    });
    expect(client.webhooks.constructEvent).toHaveBeenCalledWith(rawBody, 'sig_123', 'whsec_123');
  });

  it('lists, creates, and deletes webhook endpoints through Stripe webhook endpoint APIs', async () => {
    const client = {
      accounts: { retrieveCurrent: vi.fn() },
      products: { list: vi.fn() },
      prices: { list: vi.fn() },
      customers: { create: vi.fn() },
      checkout: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn() },
      webhookEndpoints: {
        list: vi
          .fn()
          .mockReturnValue(createAsyncList([{ id: 'we_123', object: 'webhook_endpoint' }])),
        create: vi.fn().mockResolvedValue({
          id: 'we_new',
          object: 'webhook_endpoint',
          secret: 'whsec_new',
        }),
        del: vi.fn().mockResolvedValue({ id: 'we_123', deleted: true }),
      },
    } as unknown as StripeClient;
    const provider = new StripeProvider('sk_test_1234567890', 'test', client);

    await expect(provider.listWebhookEndpoints()).resolves.toEqual([
      { id: 'we_123', object: 'webhook_endpoint' },
    ]);
    await expect(
      provider.createWebhookEndpoint({
        url: 'https://example.com/api/webhooks/stripe/test',
        enabledEvents: ['checkout.session.completed'],
        metadata: { managed_by: 'insforge' },
      })
    ).resolves.toMatchObject({ id: 'we_new', secret: 'whsec_new' });
    await provider.deleteWebhookEndpoint('we_123');

    expect(client.webhookEndpoints.list).toHaveBeenCalledWith({ limit: 100 });
    expect(client.webhookEndpoints.create).toHaveBeenCalledWith({
      url: 'https://example.com/api/webhooks/stripe/test',
      enabled_events: ['checkout.session.completed'],
      api_version: Stripe.API_VERSION,
      metadata: { managed_by: 'insforge' },
    });
    expect(client.webhookEndpoints.del).toHaveBeenCalledWith('we_123');
  });
});
