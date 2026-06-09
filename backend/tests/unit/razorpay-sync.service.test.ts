import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RazorpayConnection, RazorpayEnvironment } from '@insforge/shared-schemas';
import type { RazorpayProvider } from '../../src/providers/payments/razorpay.provider';

const { mockConfigService, mockPool, mockWithPaymentSessionAdvisoryLock } = vi.hoisted(() => ({
  mockConfigService: {
    listRazorpayEnvironments: vi.fn(),
    createRazorpayProvider: vi.fn(),
    recordConnectionStatus: vi.fn(),
    writeSnapshot: vi.fn(),
    writeFailedSnapshot: vi.fn(),
    getConnection: vi.fn(),
  },
  mockPool: {
    connect: vi.fn(),
  },
  mockWithPaymentSessionAdvisoryLock: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/services/payments/payments-advisory-lock', () => ({
  withPaymentSessionAdvisoryLock: mockWithPaymentSessionAdvisoryLock,
}));

vi.mock('../../src/services/payments/razorpay/config.service', () => ({
  RazorpayConfigService: {
    getInstance: () => mockConfigService,
  },
}));

import { RazorpaySyncService } from '../../src/services/payments/razorpay/sync.service';

function makeConnection(
  environment: RazorpayEnvironment,
  status: RazorpayConnection['status'],
  lastSyncError: string | null
): RazorpayConnection {
  return {
    environment,
    status,
    accountId: null,
    merchantName: null,
    accountLivemode: null,
    webhookEndpointId: null,
    webhookEndpointUrl: null,
    webhookConfiguredAt: null,
    maskedKey: null,
    lastSyncedAt: null,
    lastSyncStatus: 'failed',
    lastSyncError,
    lastSyncCounts: {},
  };
}

describe('RazorpaySyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockWithPaymentSessionAdvisoryLock.mockImplementation(
      async (_pool: unknown, _lockName: string, task: () => Promise<unknown>) => task()
    );
    mockPool.connect.mockResolvedValue(mockClient);
    mockConfigService.listRazorpayEnvironments.mockReturnValue(['test', 'live']);
    mockConfigService.createRazorpayProvider.mockRejectedValue(new Error('missing keys'));
    mockConfigService.recordConnectionStatus.mockImplementation(
      async (
        environment: RazorpayEnvironment,
        status: RazorpayConnection['status'],
        error: string
      ) => makeConnection(environment, status, error)
    );
    mockConfigService.writeSnapshot.mockResolvedValue(undefined);
    mockConfigService.writeFailedSnapshot.mockResolvedValue(undefined);
    mockConfigService.getConnection.mockImplementation(async (environment: RazorpayEnvironment) =>
      makeConnection(environment, 'connected', 'customers: customer API unavailable')
    );
  });

  it('returns failed unconfigured results for missing keys while using environment locks', async () => {
    const service = RazorpaySyncService.getInstance();

    const result = await service.syncAll('test');

    expect(mockWithPaymentSessionAdvisoryLock).toHaveBeenCalledWith(
      mockPool,
      'payments_razorpay_environment_test',
      expect.any(Function)
    );
    expect(mockConfigService.recordConnectionStatus).toHaveBeenCalledWith(
      'test',
      'unconfigured',
      'missing keys'
    );
    expect(result).toEqual({
      results: [
        {
          environment: 'test',
          status: 'failed',
          connection: makeConnection('test', 'unconfigured', 'missing keys'),
          syncCounts: {
            plans: 0,
            items: 0,
            customers: 0,
            subscriptions: 0,
            invoices: 0,
            payments: 0,
          },
          error: 'missing keys',
        },
      ],
    });
  });

  it('syncs all supported Razorpay environments through the same result envelope', async () => {
    const service = RazorpaySyncService.getInstance();

    const result = await service.syncAll('all');

    expect(result.results.map((item) => item.environment)).toEqual(['test', 'live']);
    expect(mockWithPaymentSessionAdvisoryLock).toHaveBeenCalledWith(
      mockPool,
      'payments_razorpay_environment_test',
      expect.any(Function)
    );
    expect(mockWithPaymentSessionAdvisoryLock).toHaveBeenCalledWith(
      mockPool,
      'payments_razorpay_environment_live',
      expect.any(Function)
    );
  });

  it('marks the environment failed when a non-catalog sync stage fails', async () => {
    const provider = {
      syncCatalog: vi.fn().mockResolvedValue({
        account: {
          id: 'acc_123',
          merchantName: 'Example Merchant',
          livemode: false,
        },
        plans: [],
        items: [],
      }),
      listCustomers: vi.fn().mockRejectedValue(new Error('customer API unavailable')),
      listSubscriptions: vi.fn().mockResolvedValue([]),
      listInvoices: vi.fn().mockResolvedValue([]),
      listPayments: vi.fn().mockResolvedValue([]),
    };
    mockConfigService.createRazorpayProvider.mockResolvedValue(provider);

    const result = await RazorpaySyncService.getInstance().syncAll('test');

    expect(mockConfigService.writeSnapshot).not.toHaveBeenCalled();
    expect(mockConfigService.writeFailedSnapshot).toHaveBeenCalledWith(
      'test',
      'acc_123',
      'Example Merchant',
      false,
      {
        plans: 0,
        items: 0,
        customers: 0,
        subscriptions: 0,
        invoices: 0,
        payments: 0,
      },
      'customers: customer API unavailable',
      expect.any(Date)
    );
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        environment: 'test',
        status: 'failed',
        syncCounts: {
          plans: 0,
          items: 0,
          customers: 0,
          subscriptions: 0,
          invoices: 0,
          payments: 0,
        },
        error: 'customers: customer API unavailable',
      })
    );
  });

  it('syncs after key changes with the already-validated Razorpay provider', async () => {
    const provider = {
      syncCatalog: vi.fn().mockResolvedValue({
        account: {
          id: 'acc_123',
          merchantName: 'Example Merchant',
          livemode: false,
        },
        plans: [],
        items: [],
      }),
      listCustomers: vi.fn().mockResolvedValue([]),
      listSubscriptions: vi.fn().mockResolvedValue([]),
      listInvoices: vi.fn().mockResolvedValue([]),
      listPayments: vi.fn().mockResolvedValue([]),
    };

    const result = await RazorpaySyncService.getInstance().syncEnvironmentAfterKeyChange(
      'test',
      provider as unknown as RazorpayProvider
    );

    expect(mockConfigService.createRazorpayProvider).not.toHaveBeenCalled();
    expect(provider.syncCatalog).toHaveBeenCalled();
    expect(mockConfigService.writeSnapshot).toHaveBeenCalledWith(
      'test',
      'acc_123',
      'Example Merchant',
      false,
      {
        plans: 0,
        items: 0,
        customers: 0,
        subscriptions: 0,
        invoices: 0,
        payments: 0,
      },
      expect.any(Date)
    );
    expect(result).toEqual(
      expect.objectContaining({
        environment: 'test',
        status: 'succeeded',
        syncCounts: {
          plans: 0,
          items: 0,
          customers: 0,
          subscriptions: 0,
          invoices: 0,
          payments: 0,
        },
        error: null,
      })
    );
  });

  it('stores Razorpay catalog data in provider-native item and plan tables', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    const provider = {
      syncCatalog: vi.fn().mockResolvedValue({
        account: {
          id: 'acc_123',
          merchantName: 'Example Merchant',
          livemode: false,
        },
        plans: [
          {
            id: 'plan_123',
            entity: 'plan',
            interval: 1,
            period: 'monthly',
            item: {
              id: 'item_123',
              name: 'Pro monthly',
              description: 'Monthly plan',
              amount: 290000,
              unit_amount: 290000,
              currency: 'INR',
              active: true,
            },
            notes: { tier: 'pro' },
            created_at: 1777248000,
          },
        ],
        items: [
          {
            id: 'item_123',
            active: true,
            amount: 290000,
            unit_amount: 290000,
            currency: 'INR',
            name: 'Pro monthly',
            description: 'Monthly plan',
            type: 'invoice',
            created_at: 1777248000,
          },
        ],
      }),
      listCustomers: vi.fn().mockResolvedValue([]),
      listSubscriptions: vi.fn().mockResolvedValue([]),
      listInvoices: vi.fn().mockResolvedValue([]),
      listPayments: vi.fn().mockResolvedValue([]),
    };
    mockConfigService.createRazorpayProvider.mockResolvedValue(provider);

    await RazorpaySyncService.getInstance().syncAll('test');

    const executedSql = mockClient.query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(executedSql).toMatch(/INSERT INTO payments\.razorpay_items/i);
    expect(executedSql).toMatch(/INSERT INTO payments\.razorpay_plans/i);
    expect(executedSql).not.toMatch(/INSERT INTO payments\.products/i);
    expect(executedSql).not.toMatch(/INSERT INTO payments\.prices/i);
    expect(executedSql).not.toMatch(/INSERT INTO payments\.subscription_items/i);
  });

  it('syncs Razorpay invoices before payments so transaction context is provider-native', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    const provider = {
      syncCatalog: vi.fn().mockResolvedValue({
        account: {
          id: 'acc_123',
          merchantName: 'Example Merchant',
          livemode: false,
        },
        plans: [],
        items: [],
      }),
      listCustomers: vi.fn().mockResolvedValue([]),
      listSubscriptions: vi.fn().mockResolvedValue([]),
      listInvoices: vi.fn().mockResolvedValue([
        {
          id: 'inv_123',
          entity: 'invoice',
          type: 'invoice',
          description: 'Pro monthly',
          customer_id: 'cust_123',
          customer_details: {
            id: 'cust_123',
            name: 'Buyer',
            email: 'buyer@example.com',
            contact: null,
          },
          order_id: 'order_123',
          subscription_id: 'sub_123',
          payment_id: 'pay_123',
          status: 'paid',
          amount: 5000,
          amount_paid: 5000,
          amount_due: 0,
          currency: 'INR',
          short_url: null,
          notes: {
            insforge_subject_type: 'team',
            insforge_subject_id: 'team_123',
          },
          line_items: [],
          paid_at: 1780617600,
          cancelled_at: null,
          expired_at: null,
          issued_at: 1780531200,
          created_at: 1780531200,
        },
      ]),
      listPayments: vi.fn().mockResolvedValue([]),
    };
    mockConfigService.createRazorpayProvider.mockResolvedValue(provider);

    await RazorpaySyncService.getInstance().syncAll('test');

    expect(provider.listInvoices.mock.invocationCallOrder[0]).toBeLessThan(
      provider.listPayments.mock.invocationCallOrder[0]
    );
    expect(mockConfigService.writeSnapshot).toHaveBeenCalledWith(
      'test',
      'acc_123',
      'Example Merchant',
      false,
      {
        plans: 0,
        items: 0,
        customers: 0,
        subscriptions: 0,
        invoices: 1,
        payments: 0,
      },
      expect.any(Date)
    );

    const transactionCall = mockClient.query.mock.calls.find(([sql]) =>
      /WITH refs[\s\S]*INSERT INTO payments\.transactions/i.test(String(sql))
    );
    expect(transactionCall).toBeDefined();
    expect(String(transactionCall?.[0])).toMatch(/RETURNING\s+tx\.id/i);

    const params = transactionCall?.[1] as unknown[];
    expect(params).toEqual(
      expect.arrayContaining([
        'test',
        'payment',
        'pay_123',
        'subscription_invoice',
        'succeeded',
        'team',
        'team_123',
        'cust_123',
        'buyer@example.com',
      ])
    );
    expect(JSON.parse(String(params[11]))).toEqual(
      expect.objectContaining({
        payment: 'pay_123',
        invoice: 'inv_123',
        order: 'order_123',
        subscription: 'sub_123',
      })
    );
  });

  it('stores Razorpay subscriptions in the provider-native subscription table', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    const provider = {
      syncCatalog: vi.fn().mockResolvedValue({
        account: {
          id: 'acc_123',
          merchantName: 'Example Merchant',
          livemode: false,
        },
        plans: [],
        items: [],
      }),
      listCustomers: vi.fn().mockResolvedValue([]),
      listSubscriptions: vi.fn().mockResolvedValue([
        {
          id: 'sub_123',
          entity: 'subscription',
          plan_id: 'plan_123',
          customer_id: 'cust_123',
          status: 'active',
          current_start: 1777248000,
          current_end: 1779840000,
          ended_at: null,
          quantity: 2,
          notes: { insforge_subject_type: 'team', insforge_subject_id: 'team_123' },
          charge_at: 1779840000,
          start_at: 1777248000,
          end_at: null,
          total_count: 12,
          auth_attempts: 1,
          paid_count: 1,
          remaining_count: 11,
          short_url: 'https://rzp.io/i/sub_123',
          has_scheduled_changes: false,
          change_scheduled_at: null,
          offer_id: null,
          created_at: 1777248000,
        },
      ]),
      listInvoices: vi.fn().mockResolvedValue([]),
      listPayments: vi.fn().mockResolvedValue([]),
    };
    mockConfigService.createRazorpayProvider.mockResolvedValue(provider);

    await RazorpaySyncService.getInstance().syncAll('test');

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.razorpay_subscriptions/i),
      expect.arrayContaining([
        'test',
        'sub_123',
        'plan_123',
        'cust_123',
        'team',
        'team_123',
        'active',
      ])
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /DELETE FROM payments\.razorpay_subscriptions[\s\S]*synced_at IS NULL OR synced_at < \$3[\s\S]*updated_at < \$3/i
      ),
      ['test', ['sub_123'], expect.any(Date)]
    );
    const subscriptionUpsertCall = mockClient.query.mock.calls.find(([sql]) =>
      /INSERT INTO payments\.razorpay_subscriptions/i.test(String(sql))
    );
    const subscriptionDeleteCall = mockClient.query.mock.calls.find(([sql]) =>
      /DELETE FROM payments\.razorpay_subscriptions/i.test(String(sql))
    );
    expect(subscriptionUpsertCall?.[1]?.[25]).toBe(subscriptionDeleteCall?.[1]?.[2]);

    const executedSql = mockClient.query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(executedSql).not.toMatch(/INSERT INTO payments\.subscriptions/i);
  });
});
