import { describe, expect, it } from 'vitest';
import type { RazorpaySubscription } from '@insforge/shared-schemas';
import { normalizeRazorpaySubscription } from '#features/payments/types/subscriptions';

function makeRazorpaySubscription(
  overrides: Partial<RazorpaySubscription> = {}
): RazorpaySubscription {
  return {
    environment: 'test',
    subscriptionId: 'sub_123',
    planId: 'plan_123',
    customerId: 'cust_123',
    subjectType: 'team',
    subjectId: 'team_123',
    status: 'active',
    currentStart: '2026-06-01T00:00:00.000Z',
    currentEnd: '2026-07-01T00:00:00.000Z',
    endedAt: null,
    quantity: 1,
    chargeAt: null,
    startAt: '2026-06-01T00:00:00.000Z',
    endAt: '2027-06-01T00:00:00.000Z',
    totalCount: 12,
    authAttempts: 0,
    paidCount: 1,
    remainingCount: 11,
    shortUrl: 'https://rzp.io/i/sub_123',
    hasScheduledChanges: false,
    changeScheduledAt: null,
    offerId: null,
    authorizationPaymentId: null,
    authorizationVerifiedAt: null,
    notes: { tier: 'pro' },
    providerCreatedAt: '2026-06-01T00:00:00.000Z',
    syncedAt: '2026-06-10T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('payment subscription normalization', () => {
  it('does not treat Razorpay endAt as a scheduled cancellation', () => {
    const subscription = normalizeRazorpaySubscription(makeRazorpaySubscription());

    expect(subscription.status).toBe('active');
    expect(subscription.cancelAtPeriodEnd).toBe(false);
    expect(subscription.cancelAt).toBeNull();
  });

  it('maps terminal Razorpay cancellations without using endAt as cancelAt', () => {
    const subscription = normalizeRazorpaySubscription(
      makeRazorpaySubscription({
        status: 'cancelled',
        endedAt: '2026-06-15T00:00:00.000Z',
        endAt: '2027-06-01T00:00:00.000Z',
      })
    );

    expect(subscription.status).toBe('canceled');
    expect(subscription.cancelAtPeriodEnd).toBe(false);
    expect(subscription.cancelAt).toBeNull();
    expect(subscription.canceledAt).toBe('2026-06-15T00:00:00.000Z');
  });
});
