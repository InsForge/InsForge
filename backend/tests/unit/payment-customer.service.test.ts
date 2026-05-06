import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeProvider } from '../../src/providers/payments/stripe.provider';

const { mockPool, mockClient } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

import { PaymentCustomerService } from '../../src/services/payments/payment-customer.service';

describe('PaymentCustomerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockReset();
    mockPool.connect.mockReset();
    mockClient.query.mockReset();
    mockClient.release.mockReset();

    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('lists mirrored Stripe customers for one environment', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          environment: 'test',
          stripeCustomerId: 'cus_123',
          email: 'buyer@example.com',
          name: 'Buyer Example',
          phone: '+1 555-0100',
          deleted: false,
          metadata: { segment: 'pro' },
          raw: {
            address: { country: 'us' },
            invoice_settings: {
              default_payment_method: {
                card: {
                  brand: 'visa',
                  last4: '4242',
                },
              },
            },
          },
          stripeCreatedAt: new Date('2026-05-01T00:00:00.000Z'),
          syncedAt: new Date('2026-05-02T00:00:00.000Z'),
          paymentsCount: 3,
          lastPaymentAt: new Date('2026-05-03T12:30:00.000Z'),
          totalSpend: 4200,
          totalSpendCurrency: 'usd',
        },
      ],
    });

    await expect(
      PaymentCustomerService.getInstance().listCustomers({
        environment: 'test',
        limit: 25,
      })
    ).resolves.toEqual({
      customers: [
        {
          environment: 'test',
          stripeCustomerId: 'cus_123',
          email: 'buyer@example.com',
          name: 'Buyer Example',
          phone: '+1 555-0100',
          deleted: false,
          metadata: { segment: 'pro' },
          stripeCreatedAt: '2026-05-01T00:00:00.000Z',
          syncedAt: '2026-05-02T00:00:00.000Z',
          paymentsCount: 3,
          lastPaymentAt: '2026-05-03T12:30:00.000Z',
          totalSpend: 4200,
          totalSpendCurrency: 'usd',
          paymentMethodBrand: 'visa',
          paymentMethodLast4: '4242',
          countryCode: 'US',
        },
      ],
    });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM payments\.customers/i),
      ['test', 25]
    );
  });

  it('builds customer payment stats by combining Stripe-customer and email-only history', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await PaymentCustomerService.getInstance().listCustomers({
      environment: 'test',
      limit: 25,
    });

    const [sql] = mockPool.query.mock.calls[0] ?? [];
    expect(sql).toMatch(/WITH unique_customer_emails AS/i);
    expect(sql).toMatch(/HAVING COUNT\(\*\) = 1/i);
    expect(sql).toMatch(
      /COALESCE\(payment_totals_by_customer\.payments_count, 0\)\s*\+\s*COALESCE\(payment_totals_by_email\.payments_count, 0\)/i
    );
    expect(sql).toMatch(/GREATEST\(\s*payment_totals_by_customer\.last_payment_at/i);
    expect(sql).toMatch(
      /WHEN COALESCE\(payment_totals_by_customer\.payments_count, 0\) = 0\s+THEN payment_totals_by_email\.total_spend/i
    );
    expect(sql).toMatch(
      /WHEN COALESCE\(payment_totals_by_email\.payments_count, 0\) = 0\s+THEN payment_totals_by_customer\.total_spend/i
    );
  });

  it('syncs Stripe customers and soft-deletes mirror rows missing from the latest provider import', async () => {
    const provider = {
      listCustomers: vi.fn().mockResolvedValue([
        {
          id: 'cus_123',
          object: 'customer',
          email: 'buyer@example.com',
          name: 'Buyer Example',
          phone: '+1 555-0100',
          deleted: false,
          metadata: { segment: 'pro' },
          created: 1777593600,
        },
        {
          id: 'cus_456',
          object: 'customer',
          email: null,
          name: 'Second Customer',
          phone: null,
          deleted: false,
          metadata: {},
          created: 1777680000,
        },
      ]),
    };

    await expect(
      PaymentCustomerService.getInstance().syncCustomersWithProvider(
        'test',
        provider as unknown as StripeProvider
      )
    ).resolves.toBe(2);

    expect(provider.listCustomers).toHaveBeenCalledTimes(1);
    expect(mockPool.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    const insertCalls = mockClient.query.mock.calls.filter(([sql]) =>
      typeof sql === 'string' ? /INSERT INTO payments\.customers/i.test(sql) : false
    );
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toEqual([
      expect.stringMatching(/INSERT INTO payments\.customers/i),
      [
        'test',
        'cus_123',
        'buyer@example.com',
        'Buyer Example',
        '+1 555-0100',
        false,
        { segment: 'pro' },
        expect.objectContaining({ id: 'cus_123' }),
        new Date('2026-05-01T00:00:00.000Z'),
        expect.any(Date),
        'test',
        'cus_456',
        null,
        'Second Customer',
        null,
        false,
        {},
        expect.objectContaining({ id: 'cus_456' }),
        new Date('2026-05-02T00:00:00.000Z'),
        expect.any(Date),
      ],
    ]);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE payments\.customers[\s\S]*NOT \(stripe_customer_id = ANY/i),
      ['test', expect.any(Date), ['cus_123', 'cus_456']]
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('preserves existing detail fields when projecting deleted Stripe customers from webhooks', async () => {
    await expect(
      PaymentCustomerService.getInstance().upsertCustomerProjection('test', {
        id: 'cus_deleted',
        deleted: true,
      })
    ).resolves.toBe(true);

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.customers/i),
      [
        'test',
        'cus_deleted',
        null,
        null,
        null,
        true,
        {},
        expect.objectContaining({ id: 'cus_deleted', deleted: true }),
        null,
        expect.any(Date),
        true,
      ]
    );

    const [sql] = mockPool.query.mock.calls[0] ?? [];
    expect(sql).toMatch(
      /raw = CASE WHEN \$11 THEN payments\.customers\.raw ELSE EXCLUDED\.raw END/i
    );
  });

  it('ignores webhook customer projections that are missing an id', async () => {
    await expect(
      PaymentCustomerService.getInstance().upsertCustomerProjection('test', {
        id: '',
        deleted: false,
      })
    ).resolves.toBe(false);

    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
