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
    mockPool.query
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
            updatedAt: new Date('2026-04-30T00:00:00.000Z'),
          },
        ],
      });

    const result = await PaymentWebhookService.getInstance().recordWebhookEventStart(
      'test',
      {
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
      } as StripeEvent
    );

    expect(result).toMatchObject({
      shouldProcess: false,
      row: {
        stripeEventId: 'evt_123',
        processingStatus: 'pending',
      },
    });
    expect(
      mockPool.query.mock.calls.some(([sql]) => /UPDATE payments\.webhook_events/i.test(String(sql)))
    ).toBe(false);
  });
});
