import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

const { mockClient, mockPool } = vi.hoisted(() => ({
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockPool: {
    connect: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

import { StripeCheckoutService } from '../../src/services/payments/stripe/checkout.service';

describe('StripeCheckoutService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  it('rejects reused idempotency keys when the metadata differs', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (
        sql === 'BEGIN' ||
        sql === 'ROLLBACK' ||
        sql === 'RESET ROLE' ||
        sql.startsWith('SET LOCAL ROLE') ||
        sql === 'SELECT set_config($1, $2, true)'
      ) {
        return { rows: [], rowCount: 0 };
      }

      if (/INSERT INTO payments\.stripe_checkout_sessions/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }

      if (/FROM payments\.stripe_checkout_sessions/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const service = StripeCheckoutService.getInstance();

    await expect(
      service.insertInitializedCheckoutSession(
        {
          environment: 'test',
          mode: 'payment',
          lineItems: [{ priceId: 'price_123', quantity: 1 }],
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          customerEmail: 'buyer@example.com',
          subject: { type: 'team', id: 'team_123' },
          idempotencyKey: 'checkout_123',
        },
        { plan: 'pro', source: 'agent' },
        {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'buyer@example.com',
          role: 'authenticated',
        }
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.PAYMENT_CHECKOUT_ALREADY_EXISTS,
    });

    expect(
      mockClient.query.mock.calls.some(([sql]) => /AND metadata = \$10::JSONB/.test(String(sql)))
    ).toBe(true);
    expect(mockClient.release).toHaveBeenCalled();
  });
});
