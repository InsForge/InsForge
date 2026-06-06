import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RazorpayWebhookEventRow } from '../../src/services/payments/razorpay/webhook.service';

const { mockConfigService, mockProvider, mockHandlerService } = vi.hoisted(() => ({
  mockConfigService: {
    getRazorpayWebhookSecret: vi.fn(),
    createRazorpayProvider: vi.fn(),
  },
  mockProvider: {
    verifyWebhookSignature: vi.fn(),
  },
  mockHandlerService: {
    dispatch: vi.fn(),
  },
}));

vi.mock('../../src/services/payments/razorpay/config.service', () => ({
  RazorpayConfigService: {
    getInstance: () => mockConfigService,
  },
}));

vi.mock('../../src/services/payments/razorpay/webhook-handlers.service', () => ({
  RazorpayWebhookHandlerService: {
    getInstance: () => mockHandlerService,
  },
}));

import { RazorpayWebhookService } from '../../src/services/payments/razorpay/webhook.service';

function makeWebhookRow(overrides: Partial<RazorpayWebhookEventRow> = {}): RazorpayWebhookEventRow {
  return {
    id: 'evt_row_123',
    environment: 'test',
    eventId: 'evt_123',
    eventType: 'payment.captured',
    processingStatus: 'pending',
    attemptCount: 1,
    lastError: null,
    receivedAt: '2026-06-05T00:00:00.000Z',
    processedAt: null,
    ...overrides,
  };
}

function makeRawWebhookBody(event: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      entity: 'event',
      account_id: 'acc_123',
      event,
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: 'pay_123',
          },
        },
      },
      created_at: 1780617600,
    })
  );
}

async function flushImmediateTasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  await Promise.resolve();
  await Promise.resolve();
}

describe('RazorpayWebhookService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mockConfigService.getRazorpayWebhookSecret.mockResolvedValue('whsec_123');
    mockConfigService.createRazorpayProvider.mockResolvedValue(mockProvider);
    mockProvider.verifyWebhookSignature.mockReturnValue(true);
    mockHandlerService.dispatch.mockResolvedValue(true);
  });

  it('acknowledges handled Razorpay events and dispatches after acknowledgement', async () => {
    const service = RazorpayWebhookService.getInstance();
    const recordSpy = vi
      .spyOn(service, 'recordWebhookEventStart')
      .mockResolvedValue({ shouldProcess: true, row: makeWebhookRow() });
    const markSpy = vi.spyOn(service, 'markWebhookEvent').mockResolvedValue(makeWebhookRow());

    const result = await service.handleRazorpayWebhook(
      'test',
      makeRawWebhookBody('payment.captured'),
      'signature',
      'evt_header_123'
    );

    expect(result).toEqual({ received: true, handled: true });
    expect(mockProvider.verifyWebhookSignature).toHaveBeenCalledWith(
      expect.any(String),
      'signature',
      'whsec_123'
    );
    expect(recordSpy).toHaveBeenCalledWith(
      'test',
      'evt_header_123',
      'payment.captured',
      expect.objectContaining({ event: 'payment.captured' })
    );

    await flushImmediateTasks();

    expect(mockHandlerService.dispatch).toHaveBeenCalledWith(
      'test',
      expect.objectContaining({ event: 'payment.captured' })
    );
    expect(markSpy).toHaveBeenCalledWith('test', 'evt_header_123', 'processed', null);
  });

  it('marks unhandled Razorpay events ignored without syncing', async () => {
    const service = RazorpayWebhookService.getInstance();
    vi.spyOn(service, 'recordWebhookEventStart').mockResolvedValue({
      shouldProcess: true,
      row: makeWebhookRow({ eventType: 'customer.created' }),
    });
    const markSpy = vi.spyOn(service, 'markWebhookEvent').mockResolvedValue(makeWebhookRow());

    const result = await service.handleRazorpayWebhook(
      'test',
      makeRawWebhookBody('customer.created'),
      'signature',
      'evt_header_456'
    );

    expect(result).toEqual({ received: true, handled: false });
    expect(markSpy).toHaveBeenCalledWith('test', 'evt_header_456', 'ignored', null);
    expect(mockHandlerService.dispatch).not.toHaveBeenCalled();
  });
});
