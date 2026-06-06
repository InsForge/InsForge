import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

import { RazorpaySubscriptionService } from '../../src/services/payments/razorpay/subscription.service';

describe('RazorpaySubscriptionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists mirrored Razorpay subscriptions from the provider-native table', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          environment: 'test',
          subscriptionId: 'sub_123',
          planId: 'plan_123',
          customerId: 'cust_123',
          subjectType: 'team',
          subjectId: 'team_123',
          status: 'active',
          currentStart: new Date('2026-04-28T00:00:00.000Z'),
          currentEnd: new Date('2026-05-28T00:00:00.000Z'),
          endedAt: null,
          quantity: '2',
          chargeAt: new Date('2026-05-28T00:00:00.000Z'),
          startAt: new Date('2026-04-28T00:00:00.000Z'),
          endAt: null,
          totalCount: '12',
          paidCount: '1',
          remainingCount: '11',
          shortUrl: 'https://rzp.io/i/sub_123',
          hasScheduledChanges: false,
          changeScheduledAt: null,
          offerId: null,
          metadata: { tier: 'pro' },
          providerCreatedAt: new Date('2026-04-27T00:00:00.000Z'),
          syncedAt: new Date('2026-04-28T00:00:01.000Z'),
          createdAt: new Date('2026-04-28T00:00:01.000Z'),
          updatedAt: new Date('2026-04-28T00:00:02.000Z'),
        },
      ],
    });

    await expect(
      RazorpaySubscriptionService.getInstance().listSubscriptions({
        environment: 'test',
        subjectType: 'team',
        subjectId: 'team_123',
        limit: 10,
      })
    ).resolves.toEqual({
      subscriptions: [
        {
          environment: 'test',
          subscriptionId: 'sub_123',
          planId: 'plan_123',
          customerId: 'cust_123',
          subjectType: 'team',
          subjectId: 'team_123',
          status: 'active',
          currentStart: '2026-04-28T00:00:00.000Z',
          currentEnd: '2026-05-28T00:00:00.000Z',
          endedAt: null,
          quantity: 2,
          chargeAt: '2026-05-28T00:00:00.000Z',
          startAt: '2026-04-28T00:00:00.000Z',
          endAt: null,
          totalCount: 12,
          paidCount: 1,
          remainingCount: 11,
          shortUrl: 'https://rzp.io/i/sub_123',
          hasScheduledChanges: false,
          changeScheduledAt: null,
          offerId: null,
          metadata: { tier: 'pro' },
          providerCreatedAt: '2026-04-27T00:00:00.000Z',
          syncedAt: '2026-04-28T00:00:01.000Z',
          createdAt: '2026-04-28T00:00:01.000Z',
          updatedAt: '2026-04-28T00:00:02.000Z',
        },
      ],
    });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM payments\.razorpay_subscriptions/i),
      ['test', 'team', 'team_123', 10]
    );
  });
});
