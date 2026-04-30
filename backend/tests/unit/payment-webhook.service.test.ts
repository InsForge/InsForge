import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeEvent } from '../../src/types/payments';

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

import { PaymentWebhookService } from '../../src/services/payments/payment-webhook.service';

describe('PaymentWebhookService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockReset();
  });

  it('does not reprocess duplicate webhook events that are still pending', async () => {
    const freshPendingUpdatedAt = new Date();

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_123',
            eventType: 'checkout.session.completed',
            livemode: false,
            stripeAccountId: null,
            objectType: 'checkout.session',
            objectId: 'cs_test_123',
            processingStatus: 'pending',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-30T00:00:00.000Z'),
            processedAt: null,
            createdAt: new Date('2026-04-30T00:00:00.000Z'),
            updatedAt: freshPendingUpdatedAt,
          },
        ],
      });

    const result = await PaymentWebhookService.getInstance().recordWebhookEventStart('test', {
      id: 'evt_123',
      type: 'checkout.session.completed',
      livemode: false,
      account: null,
      data: {
        object: {
          id: 'cs_test_123',
          object: 'checkout.session',
        },
      },
    } as StripeEvent);

    expect(result).toMatchObject({
      shouldProcess: false,
      row: {
        stripeEventId: 'evt_123',
        processingStatus: 'pending',
      },
    });
    expect(
      mockPool.query.mock.calls.some(([sql]) =>
        /UPDATE payments\.webhook_events/i.test(String(sql))
      )
    ).toBe(true);
    expect(mockPool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(
        /UPDATE payments\.webhook_events[\s\S]*processing_status = 'failed'[\s\S]*OR \(processing_status = 'pending' AND updated_at < \$4\)/i
      ),
      ['test', 'evt_123', expect.any(Object), expect.any(Date)]
    );
  });

  it('reclaims stale pending webhook events for retry', async () => {
    const reclaimedUpdatedAt = new Date();

    mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          environment: 'test',
          stripeEventId: 'evt_123',
          eventType: 'checkout.session.completed',
          livemode: false,
          stripeAccountId: null,
          objectType: 'checkout.session',
          objectId: 'cs_test_123',
          processingStatus: 'pending',
          attemptCount: 2,
          lastError: null,
          receivedAt: new Date('2026-04-30T00:00:00.000Z'),
          processedAt: null,
          createdAt: new Date('2026-04-30T00:00:00.000Z'),
          updatedAt: reclaimedUpdatedAt,
        },
      ],
    });

    const result = await PaymentWebhookService.getInstance().recordWebhookEventStart('test', {
      id: 'evt_123',
      type: 'checkout.session.completed',
      livemode: false,
      account: null,
      data: {
        object: {
          id: 'cs_test_123',
          object: 'checkout.session',
        },
      },
    } as StripeEvent);

    expect(result).toMatchObject({
      shouldProcess: true,
      row: {
        stripeEventId: 'evt_123',
        processingStatus: 'pending',
        attemptCount: 2,
      },
    });
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });
});
