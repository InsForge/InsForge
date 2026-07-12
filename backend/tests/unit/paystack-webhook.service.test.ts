import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import type { PaystackWebhookEventRow } from '../../src/services/payments/paystack/webhook.service';

const {
  mockPool,
  mockConfigService,
  mockProvider,
  mockRecordStart,
  mockMark,
  mockUpsertCharge,
  mockUpsertRefund,
  mockExtractBoundTransactionId,
} = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
  },
  mockConfigService: {
    createPaystackProvider: vi.fn(),
  },
  mockProvider: {
    verifyWebhookSignature: vi.fn(),
  },
  mockRecordStart: vi.fn(),
  mockMark: vi.fn(),
  mockUpsertCharge: vi.fn(),
  mockUpsertRefund: vi.fn(),
  mockExtractBoundTransactionId: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/services/payments/paystack/config.service', () => ({
  PaystackConfigService: {
    getInstance: () => mockConfigService,
  },
}));

vi.mock('../../src/services/payments/webhook-store.service', () => ({
  WebhookStoreService: {
    getInstance: () => ({
      recordStart: mockRecordStart,
      mark: mockMark,
    }),
  },
}));

vi.mock('../../src/services/payments/paystack/transaction.service', () => ({
  PaystackTransactionService: {
    getInstance: () => ({
      upsertChargeTransaction: mockUpsertCharge,
      upsertRefundTransaction: mockUpsertRefund,
      extractBoundTransactionId: mockExtractBoundTransactionId,
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { PaystackWebhookService } from '../../src/services/payments/paystack/webhook.service';

function makeWebhookRow(overrides: Partial<PaystackWebhookEventRow> = {}): PaystackWebhookEventRow {
  return {
    id: 'evt_row_123',
    environment: 'test',
    eventId: 'charge.success.12345',
    eventType: 'charge.success',
    processingStatus: 'pending',
    attemptCount: 1,
    lastError: null,
    receivedAt: '2026-07-01T10:00:00.000Z',
    processedAt: null,
    ...overrides,
  };
}

const CHARGE_DATA = {
  id: 12345,
  reference: 'ps_ref_123',
  status: 'success',
  amount: 500000,
  currency: 'NGN',
  paid_at: '2026-07-01T10:00:00.000Z',
  created_at: '2026-07-01T09:59:00.000Z',
  metadata: {},
  customer: {
    id: 99,
    customer_code: 'CUS_123',
    email: 'buyer@example.com',
    first_name: 'Buyer',
    last_name: 'Example',
  },
};

function makeRawWebhookBody(event: string, data: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({ event, data }));
}

describe('PaystackWebhookService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigService.createPaystackProvider.mockResolvedValue(mockProvider);
    mockProvider.verifyWebhookSignature.mockReturnValue(true);
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockRecordStart.mockResolvedValue({ shouldProcess: true, row: makeWebhookRow() });
    mockMark.mockResolvedValue(makeWebhookRow());
    mockUpsertCharge.mockResolvedValue('succeeded');
    mockUpsertRefund.mockResolvedValue(undefined);
    mockExtractBoundTransactionId.mockReturnValue('local_txn_123');
  });

  it('rejects invalid webhook signatures before recording anything', async () => {
    mockProvider.verifyWebhookSignature.mockReturnValue(false);

    await expect(
      PaystackWebhookService.getInstance().handlePaystackWebhook(
        'test',
        makeRawWebhookBody('charge.success', CHARGE_DATA),
        'bad_signature'
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.INVALID_INPUT,
      message: expect.stringMatching(/Invalid Paystack webhook signature/),
    });

    expect(mockProvider.verifyWebhookSignature).toHaveBeenCalledWith(
      expect.any(Buffer),
      'bad_signature'
    );
    expect(mockRecordStart).not.toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('processes charge.success: records, marks the row success, and projects the charge', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ subjectType: 'team', subjectId: 'team_123', customerEmail: 'buyer@example.com' }],
      rowCount: 1,
    });

    const result = await PaystackWebhookService.getInstance().handlePaystackWebhook(
      'test',
      makeRawWebhookBody('charge.success', CHARGE_DATA),
      'signature'
    );

    expect(result).toEqual({ received: true, handled: true });
    // The secret key doubles as the HMAC key, so verification takes only (body, signature).
    expect(mockProvider.verifyWebhookSignature).toHaveBeenCalledWith(
      expect.any(Buffer),
      'signature'
    );
    expect(mockProvider.verifyWebhookSignature.mock.calls[0]).toHaveLength(2);
    expect(mockRecordStart).toHaveBeenCalledWith({
      provider: 'paystack',
      environment: 'test',
      eventId: 'charge.success.12345',
      eventType: 'charge.success',
      livemode: false,
      payload: {
        event: 'charge.success',
        data: expect.objectContaining({ id: 12345, reference: 'ps_ref_123' }),
      },
    });
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /UPDATE payments\.paystack_transactions[\s\S]*SET status = 'success'[\s\S]*AND id = \$5/i
      ),
      [
        'test',
        'ps_ref_123',
        '12345',
        expect.objectContaining({ reference: 'ps_ref_123' }),
        'local_txn_123',
      ]
    );
    expect(mockUpsertCharge).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ id: 12345, reference: 'ps_ref_123' }),
      {
        subjectFallback: { type: 'team', id: 'team_123' },
        customerEmailFallback: 'buyer@example.com',
      }
    );
    expect(mockMark).toHaveBeenCalledWith(
      'paystack',
      'test',
      'charge.success.12345',
      'processed',
      null
    );
  });

  it('projects an unbound charge.success without touching any local row or borrowing its subject', async () => {
    // A signed charge whose metadata does not claim a local session (created
    // outside this project, or pointed at a foreign reference) must not mark
    // any row or lend a row's subject to the ledger projection.
    mockExtractBoundTransactionId.mockReturnValue(null);

    const result = await PaystackWebhookService.getInstance().handlePaystackWebhook(
      'test',
      makeRawWebhookBody('charge.success', CHARGE_DATA),
      'signature'
    );

    expect(result).toEqual({ received: true, handled: true });
    expect(mockPool.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE payments\.paystack_transactions/i),
      expect.anything()
    );
    expect(mockUpsertCharge).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ reference: 'ps_ref_123' }),
      {
        subjectFallback: null,
        customerEmailFallback: null,
      }
    );
  });

  it('projects refund.processed into the shared ledger as a refunded refund', async () => {
    const refundData = {
      id: 777,
      transaction_reference: 'ps_ref_123',
      amount: 1200,
      currency: 'NGN',
      status: 'processed',
    };

    const result = await PaystackWebhookService.getInstance().handlePaystackWebhook(
      'test',
      makeRawWebhookBody('refund.processed', refundData),
      'signature'
    );

    expect(result).toEqual({ received: true, handled: true });
    expect(mockUpsertRefund).toHaveBeenCalledWith(
      'test',
      expect.objectContaining(refundData),
      'refunded'
    );
    expect(mockUpsertCharge).not.toHaveBeenCalled();
    expect(mockMark).toHaveBeenCalledWith(
      'paystack',
      'test',
      'refund.processed.777',
      'processed',
      null
    );
  });

  it('projects refund.failed into the shared ledger as a failed refund', async () => {
    const refundData = {
      id: 778,
      transaction: 12345,
      amount: 1200,
      currency: 'NGN',
      status: 'failed',
    };

    const result = await PaystackWebhookService.getInstance().handlePaystackWebhook(
      'test',
      makeRawWebhookBody('refund.failed', refundData),
      'signature'
    );

    expect(result).toEqual({ received: true, handled: true });
    expect(mockUpsertRefund).toHaveBeenCalledWith(
      'test',
      expect.objectContaining(refundData),
      'failed'
    );
    expect(mockMark).toHaveBeenCalledWith(
      'paystack',
      'test',
      'refund.failed.778',
      'processed',
      null
    );
  });

  it('ignores refund events without a refund id instead of projecting them', async () => {
    const result = await PaystackWebhookService.getInstance().handlePaystackWebhook(
      'test',
      makeRawWebhookBody('refund.processed', {
        transaction_reference: 'ps_ref_123',
        amount: 1200,
        currency: 'NGN',
        status: 'processed',
      }),
      'signature'
    );

    expect(result).toEqual({ received: true, handled: false });
    expect(mockUpsertRefund).not.toHaveBeenCalled();
    expect(mockMark).toHaveBeenCalledWith(
      'paystack',
      'test',
      'refund.processed.no_entity',
      'ignored',
      null
    );
  });

  it('marks the event failed when the refund projection throws', async () => {
    mockUpsertRefund.mockRejectedValue(new Error('ledger unavailable'));

    await expect(
      PaystackWebhookService.getInstance().handlePaystackWebhook(
        'test',
        makeRawWebhookBody('refund.processed', {
          id: 777,
          transaction_reference: 'ps_ref_123',
          amount: 1200,
          currency: 'NGN',
          status: 'processed',
        }),
        'signature'
      )
    ).rejects.toThrow('ledger unavailable');

    expect(mockMark).toHaveBeenCalledWith(
      'paystack',
      'test',
      'refund.processed.777',
      'failed',
      'ledger unavailable'
    );
  });

  it('marks unknown events ignored and reports them unhandled', async () => {
    const result = await PaystackWebhookService.getInstance().handlePaystackWebhook(
      'test',
      makeRawWebhookBody('subscription.create', { id: 888 }),
      'signature'
    );

    expect(result).toEqual({ received: true, handled: false });
    expect(mockMark).toHaveBeenCalledWith(
      'paystack',
      'test',
      'subscription.create.888',
      'ignored',
      null
    );
    expect(mockUpsertCharge).not.toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('short-circuits duplicate events the store already processed', async () => {
    mockRecordStart.mockResolvedValue({
      shouldProcess: false,
      row: makeWebhookRow({ processingStatus: 'processed' }),
    });

    const result = await PaystackWebhookService.getInstance().handlePaystackWebhook(
      'test',
      makeRawWebhookBody('charge.success', CHARGE_DATA),
      'signature'
    );

    expect(result).toEqual({ received: true, handled: false });
    expect(mockRecordStart).toHaveBeenCalledTimes(1);
    expect(mockMark).not.toHaveBeenCalled();
    expect(mockUpsertCharge).not.toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
