import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockPoolQuery,
  mockUserClientQuery,
  mockCreateSubscription,
  mockCancelSubscription,
  mockPauseSubscription,
  mockResumeSubscription,
  mockVerifySubscriptionPaymentSignature,
  mockCreateRazorpayProvider,
  mockWithUserContext,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockUserClientQuery: vi.fn(),
  mockCreateSubscription: vi.fn(),
  mockCancelSubscription: vi.fn(),
  mockPauseSubscription: vi.fn(),
  mockResumeSubscription: vi.fn(),
  mockVerifySubscriptionPaymentSignature: vi.fn(),
  mockCreateRazorpayProvider: vi.fn(),
  mockWithUserContext: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => ({
        query: mockPoolQuery,
      }),
    }),
  },
}));

vi.mock('../../src/services/payments/razorpay/config.service', () => ({
  RazorpayConfigService: {
    getInstance: () => ({
      createRazorpayProvider: mockCreateRazorpayProvider,
    }),
  },
}));

vi.mock('../../src/services/database/user-context.service', () => ({
  withUserContext: mockWithUserContext,
}));

import { RazorpaySubscriptionService } from '../../src/services/payments/razorpay/subscription.service';
import type { RazorpaySubscription } from '../../src/providers/payments/razorpay.provider';

function buildSubscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    environment: 'test',
    subscriptionId: 'sub_123',
    planId: 'plan_123',
    customerId: 'cust_123',
    subjectType: 'team',
    subjectId: 'team_123',
    status: 'created',
    currentStart: null,
    currentEnd: null,
    endedAt: null,
    quantity: 1,
    chargeAt: null,
    startAt: null,
    endAt: null,
    totalCount: 12,
    authAttempts: 0,
    paidCount: 0,
    remainingCount: 12,
    shortUrl: 'https://rzp.io/i/sub_123',
    hasScheduledChanges: false,
    changeScheduledAt: null,
    offerId: null,
    authorizationPaymentId: null,
    authorizationVerifiedAt: null,
    metadata: {
      insforge_subject_type: 'team',
      insforge_subject_id: 'team_123',
    },
    providerCreatedAt: new Date('2026-01-01T00:00:00Z'),
    syncedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildProviderSubscription(
  overrides: Partial<RazorpaySubscription> = {}
): RazorpaySubscription {
  return {
    id: 'sub_123',
    entity: 'subscription',
    plan_id: 'plan_123',
    customer_id: 'cust_123',
    status: 'active',
    current_start: null,
    current_end: null,
    ended_at: null,
    quantity: 1,
    notes: {
      insforge_subject_type: 'team',
      insforge_subject_id: 'team_123',
    },
    charge_at: null,
    start_at: null,
    end_at: null,
    total_count: 12,
    auth_attempts: 0,
    paid_count: 1,
    remaining_count: 11,
    short_url: 'https://rzp.io/i/sub_123',
    has_scheduled_changes: false,
    change_scheduled_at: null,
    offer_id: null,
    created_at: 1767225600,
    ...overrides,
  };
}

describe('RazorpaySubscriptionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithUserContext.mockImplementation(async (_pool, _user, task) =>
      task({ query: mockUserClientQuery })
    );
    mockCreateRazorpayProvider.mockResolvedValue({
      getKeyId: () => 'rzp_test_key',
      createSubscription: mockCreateSubscription,
      cancelSubscription: mockCancelSubscription,
      pauseSubscription: mockPauseSubscription,
      resumeSubscription: mockResumeSubscription,
      verifySubscriptionPaymentSignature: mockVerifySubscriptionPaymentSignature,
    });
  });

  it('creates a native Razorpay subscription and returns Checkout options', async () => {
    mockCreateSubscription.mockResolvedValue({
      id: 'sub_123',
      entity: 'subscription',
      plan_id: 'plan_123',
      customer_id: 'cust_123',
      status: 'created',
      current_start: null,
      current_end: null,
      ended_at: null,
      quantity: 1,
      notes: {
        insforge_subject_type: 'team',
        insforge_subject_id: 'team_123',
      },
      charge_at: null,
      start_at: null,
      end_at: null,
      total_count: 12,
      auth_attempts: 0,
      paid_count: 0,
      remaining_count: 12,
      short_url: 'https://rzp.io/i/sub_123',
      has_scheduled_changes: false,
      change_scheduled_at: null,
      offer_id: null,
      created_at: 1767225600,
    });
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [buildSubscriptionRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await RazorpaySubscriptionService.getInstance().createSubscription(
      {
        environment: 'test',
        planId: 'plan_123',
        totalCount: 12,
        subject: { type: 'team', id: 'team_123' },
        customerEmail: 'buyer@example.com',
        description: 'Pro monthly',
      },
      { role: 'authenticated', id: 'user_123', email: 'buyer@example.com' }
    );

    expect(mockUserClientQuery).toHaveBeenNthCalledWith(
      1,
      'SAVEPOINT razorpay_subscription_rls_probe'
    );
    expect(mockUserClientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/INSERT INTO payments\.razorpay_subscriptions/i),
      expect.arrayContaining(['test', expect.stringMatching(/^sub_rls_probe_/), 'plan_123'])
    );
    expect(mockUserClientQuery).toHaveBeenNthCalledWith(
      3,
      'ROLLBACK TO SAVEPOINT razorpay_subscription_rls_probe'
    );
    expect(mockUserClientQuery).toHaveBeenNthCalledWith(
      4,
      'RELEASE SAVEPOINT razorpay_subscription_rls_probe'
    );
    expect(mockCreateSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'plan_123',
        totalCount: 12,
        notes: expect.objectContaining({
          insforge_subject_type: 'team',
          insforge_subject_id: 'team_123',
        }),
      })
    );
    expect(mockPoolQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/INSERT INTO payments\.razorpay_subscriptions/i),
      expect.arrayContaining(['test', 'sub_123', 'plan_123', 'cust_123', 'team', 'team_123'])
    );
    expect(mockPoolQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/INSERT INTO payments\.customer_mappings/i),
      ['test', 'team', 'team_123', 'cust_123']
    );
    expect(result.checkoutOptions).toEqual(
      expect.objectContaining({
        key: 'rzp_test_key',
        subscription_id: 'sub_123',
        description: 'Pro monthly',
      })
    );
  });

  it('rejects Razorpay subscription creation when RLS denies the subject probe', async () => {
    const permissionError = Object.assign(new Error('permission denied'), { code: '42501' });
    mockUserClientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockUserClientQuery.mockRejectedValueOnce(permissionError);
    mockUserClientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockUserClientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      RazorpaySubscriptionService.getInstance().createSubscription(
        {
          environment: 'test',
          planId: 'plan_123',
          totalCount: 12,
          subject: { type: 'team', id: 'team_123' },
        },
        { role: 'authenticated', id: 'user_123', email: 'buyer@example.com' }
      )
    ).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(mockCreateRazorpayProvider).not.toHaveBeenCalled();
    expect(mockCreateSubscription).not.toHaveBeenCalled();
  });

  it('rejects anonymous Razorpay subscription actions before RLS or provider calls', async () => {
    await expect(
      RazorpaySubscriptionService.getInstance().createSubscription(
        {
          environment: 'test',
          planId: 'plan_123',
          totalCount: 12,
          subject: { type: 'team', id: 'team_123' },
        },
        { role: 'anon', id: 'anon_123' }
      )
    ).rejects.toMatchObject({
      statusCode: 401,
    });

    await expect(
      RazorpaySubscriptionService.getInstance().cancelSubscription(
        {
          environment: 'test',
          subscriptionId: 'sub_123',
        },
        { role: 'anon', id: 'anon_123' }
      )
    ).rejects.toMatchObject({
      statusCode: 401,
    });

    expect(mockWithUserContext).not.toHaveBeenCalled();
    expect(mockCreateRazorpayProvider).not.toHaveBeenCalled();
    expect(mockCreateSubscription).not.toHaveBeenCalled();
    expect(mockCancelSubscription).not.toHaveBeenCalled();
  });

  it('verifies the Razorpay subscription Checkout signature before recording authorization', async () => {
    mockVerifySubscriptionPaymentSignature.mockReturnValue(true);
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        buildSubscriptionRow({
          status: 'authenticated',
          authorizationPaymentId: 'pay_123',
          authorizationVerifiedAt: new Date('2026-01-02T00:00:00Z'),
        }),
      ],
      rowCount: 1,
    });

    const result = await RazorpaySubscriptionService.getInstance().verifySubscriptionPayment({
      environment: 'test',
      subscriptionId: 'sub_123',
      paymentId: 'pay_123',
      signature: 'signature',
    });

    expect(mockVerifySubscriptionPaymentSignature).toHaveBeenCalledWith(
      'sub_123',
      'pay_123',
      'signature'
    );
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringMatching(/authorization_payment_id = \$3/i),
      ['test', 'sub_123', 'pay_123']
    );
    expect(result.verified).toBe(true);
    expect(result.subscription.status).toBe('authenticated');
    expect(result.subscription.authorizationPaymentId).toBe('pay_123');
    expect(result.subscription.authorizationVerifiedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('rejects invalid Razorpay subscription Checkout signatures without updating state', async () => {
    mockVerifySubscriptionPaymentSignature.mockReturnValue(false);

    await expect(
      RazorpaySubscriptionService.getInstance().verifySubscriptionPayment({
        environment: 'test',
        subscriptionId: 'sub_123',
        paymentId: 'pay_123',
        signature: 'bad',
      })
    ).rejects.toThrow(/Invalid Razorpay subscription signature/);

    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('cancels a Razorpay subscription after the caller passes the UPDATE RLS probe', async () => {
    mockUserClientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ type: 'team', id: 'team_123' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockCancelSubscription.mockResolvedValue(buildProviderSubscription({ status: 'cancelled' }));
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [buildSubscriptionRow({ status: 'cancelled' })],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await RazorpaySubscriptionService.getInstance().cancelSubscription(
      {
        environment: 'test',
        subscriptionId: 'sub_123',
        cancelAtCycleEnd: true,
      },
      { role: 'authenticated', id: 'user_123', email: 'buyer@example.com' }
    );

    expect(mockUserClientQuery).toHaveBeenNthCalledWith(
      1,
      'SAVEPOINT razorpay_subscription_rls_probe'
    );
    expect(mockUserClientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/UPDATE payments\.razorpay_subscriptions[\s\S]*RETURNING/i),
      ['test', 'sub_123']
    );
    expect(mockUserClientQuery).toHaveBeenNthCalledWith(
      3,
      'ROLLBACK TO SAVEPOINT razorpay_subscription_rls_probe'
    );
    expect(mockUserClientQuery).toHaveBeenNthCalledWith(
      4,
      'RELEASE SAVEPOINT razorpay_subscription_rls_probe'
    );
    expect(mockCancelSubscription).toHaveBeenCalledWith('sub_123', { cancelAtCycleEnd: true });
    expect(mockPoolQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/INSERT INTO payments\.razorpay_subscriptions/i),
      expect.arrayContaining(['test', 'sub_123', 'plan_123', 'cust_123', 'team', 'team_123'])
    );
    expect(result.subscription.status).toBe('cancelled');
  });

  it('pauses and resumes Razorpay subscriptions through native action APIs', async () => {
    mockUserClientQuery
      .mockResolvedValue({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ type: 'team', id: 'team_123' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ type: 'team', id: 'team_123' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockPauseSubscription.mockResolvedValue(buildProviderSubscription({ status: 'paused' }));
    mockResumeSubscription.mockResolvedValue(buildProviderSubscription({ status: 'active' }));
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [buildSubscriptionRow({ status: 'paused' })], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buildSubscriptionRow({ status: 'active' })], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const user = { role: 'authenticated' as const, id: 'user_123', email: 'buyer@example.com' };
    const pauseResult = await RazorpaySubscriptionService.getInstance().pauseSubscription(
      {
        environment: 'test',
        subscriptionId: 'sub_123',
      },
      user
    );
    const resumeResult = await RazorpaySubscriptionService.getInstance().resumeSubscription(
      {
        environment: 'test',
        subscriptionId: 'sub_123',
      },
      user
    );

    expect(mockPauseSubscription).toHaveBeenCalledWith('sub_123');
    expect(mockResumeSubscription).toHaveBeenCalledWith('sub_123');
    expect(pauseResult.subscription.status).toBe('paused');
    expect(resumeResult.subscription.status).toBe('active');
  });

  it('does not call Razorpay when subscription management is denied by RLS', async () => {
    mockUserClientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      RazorpaySubscriptionService.getInstance().pauseSubscription(
        {
          environment: 'test',
          subscriptionId: 'sub_123',
        },
        { role: 'authenticated', id: 'user_123', email: 'buyer@example.com' }
      )
    ).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(mockPauseSubscription).not.toHaveBeenCalled();
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});
