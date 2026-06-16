import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PaymentWebhookEventRow,
  RecordWebhookEventInput,
} from '../../src/services/payments/webhook-store.service';

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

import { WebhookStoreService } from '../../src/services/payments/webhook-store.service';

function makeRow(overrides: Partial<PaymentWebhookEventRow> = {}): PaymentWebhookEventRow {
  return {
    id: 'whe_1',
    environment: 'test',
    provider: 'stripe',
    eventId: 'evt_1',
    eventType: 'checkout.session.completed',
    livemode: false,
    accountId: null,
    objectType: 'checkout.session',
    objectId: 'cs_test_1',
    processingStatus: 'pending',
    attemptCount: 1,
    lastError: null,
    receivedAt: new Date('2026-06-15T00:00:00.000Z'),
    processedAt: null,
    createdAt: new Date('2026-06-15T00:00:00.000Z'),
    updatedAt: new Date('2026-06-15T00:00:00.000Z'),
    ...overrides,
  };
}

const input: RecordWebhookEventInput = {
  provider: 'stripe',
  environment: 'test',
  eventId: 'evt_1',
  eventType: 'checkout.session.completed',
  livemode: false,
  payload: { id: 'evt_1' },
  accountId: null,
  objectType: 'checkout.session',
  objectId: 'cs_test_1',
};

describe('WebhookStoreService.recordStart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockReset();
  });

  it('processes a brand-new event when the INSERT wins', async () => {
    const row = makeRow();
    mockPool.query.mockResolvedValueOnce({ rows: [row] });

    const result = await WebhookStoreService.getInstance().recordStart(input);

    expect(result).toEqual({ row, shouldProcess: true });
    // Only the INSERT runs; no reclaim/select needed.
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO payments.webhook_events');
    expect(params).toEqual([
      'stripe',
      'test',
      'evt_1',
      'checkout.session.completed',
      false,
      null,
      'checkout.session',
      'cs_test_1',
      { id: 'evt_1' },
    ]);
  });

  it('reclaims and reprocesses a failed/stale-pending event via the UPDATE', async () => {
    const row = makeRow({ attemptCount: 2 });
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // INSERT no-op (conflict)
      .mockResolvedValueOnce({ rows: [row] }); // UPDATE reclaim wins

    const result = await WebhookStoreService.getInstance().recordStart(input);

    expect(result).toEqual({ row, shouldProcess: true });
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    expect(mockPool.query.mock.calls[1][0]).toContain('UPDATE payments.webhook_events');
  });

  it('skips an event that is already terminal/in-flight via the SELECT', async () => {
    const row = makeRow({ processingStatus: 'processed' });
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // INSERT no-op
      .mockResolvedValueOnce({ rows: [] }) // UPDATE no-op (not failed/stale)
      .mockResolvedValueOnce({ rows: [row] }); // SELECT existing

    const result = await WebhookStoreService.getInstance().recordStart(input);

    expect(result).toEqual({ row, shouldProcess: false });
    expect(mockPool.query).toHaveBeenCalledTimes(3);
    expect(mockPool.query.mock.calls[2][0]).toContain('SELECT');
  });

  it('throws when the conflicting row vanishes before the SELECT', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(WebhookStoreService.getInstance().recordStart(input)).rejects.toThrow(
      /vanished during recording/
    );
  });
});

describe('WebhookStoreService.mark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockReset();
  });

  it('returns the updated row on success', async () => {
    const row = makeRow({ processingStatus: 'processed' });
    mockPool.query.mockResolvedValueOnce({ rows: [row] });

    const result = await WebhookStoreService.getInstance().mark(
      'stripe',
      'test',
      'evt_1',
      'processed',
      null
    );

    expect(result).toEqual(row);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('UPDATE payments.webhook_events');
    expect(params).toEqual(['stripe', 'test', 'evt_1', 'processed', null]);
  });

  it('throws when the event row is missing', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await expect(
      WebhookStoreService.getInstance().mark('stripe', 'test', 'evt_1', 'processed', null)
    ).rejects.toThrow(/not found while marking/);
  });
});
