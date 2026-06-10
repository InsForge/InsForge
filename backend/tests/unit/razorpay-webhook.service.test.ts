import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RazorpayWebhookPayload } from '../../src/providers/payments/razorpay.provider';
import type { RazorpayWebhookEventRow } from '../../src/services/payments/razorpay/webhook.service';
import type { RazorpayEnvironment } from '../../src/types/payments';

const { mockConfigService, mockProvider, mockPool } = vi.hoisted(() => ({
  mockConfigService: {
    getRazorpayWebhookSecret: vi.fn(),
    createRazorpayProvider: vi.fn(),
  },
  mockProvider: {
    verifyWebhookSignature: vi.fn(),
  },
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

vi.mock('../../src/services/payments/razorpay/config.service', () => ({
  RazorpayConfigService: {
    getInstance: () => mockConfigService,
  },
}));

import { RazorpayWebhookService } from '../../src/services/payments/razorpay/webhook.service';

interface RazorpayWebhookServiceInternals {
  applyRazorpayWebhookEvent(
    environment: RazorpayEnvironment,
    payload: RazorpayWebhookPayload
  ): Promise<boolean>;
}

function getServiceInternals(service: RazorpayWebhookService): RazorpayWebhookServiceInternals {
  return service as unknown as RazorpayWebhookServiceInternals;
}

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

function makeWebhookPayload(event: string): RazorpayWebhookPayload {
  return JSON.parse(makeRawWebhookBody(event).toString('utf8')) as RazorpayWebhookPayload;
}

describe('RazorpayWebhookService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mockConfigService.getRazorpayWebhookSecret.mockResolvedValue('whsec_123');
    mockConfigService.createRazorpayProvider.mockResolvedValue(mockProvider);
    mockProvider.verifyWebhookSignature.mockReturnValue(true);
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('processes handled Razorpay events before acknowledging them', async () => {
    const service = RazorpayWebhookService.getInstance();
    const recordSpy = vi
      .spyOn(service, 'recordWebhookEventStart')
      .mockResolvedValue({ shouldProcess: true, row: makeWebhookRow() });
    const markSpy = vi.spyOn(service, 'markWebhookEvent').mockResolvedValue(makeWebhookRow());
    const applySpy = vi
      .spyOn(getServiceInternals(service), 'applyRazorpayWebhookEvent')
      .mockResolvedValue(true);

    const result = await service.handleRazorpayWebhook(
      'test',
      makeRawWebhookBody('payment.captured'),
      'signature',
      'evt_header_123'
    );

    expect(result).toEqual({ received: true, handled: true });
    expect(mockProvider.verifyWebhookSignature).toHaveBeenCalledWith(
      expect.any(Buffer),
      'signature',
      'whsec_123'
    );
    expect(recordSpy).toHaveBeenCalledWith(
      'test',
      'evt_header_123',
      'payment.captured',
      expect.objectContaining({ event: 'payment.captured' })
    );
    expect(applySpy).toHaveBeenCalledWith(
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
    const applySpy = vi
      .spyOn(getServiceInternals(service), 'applyRazorpayWebhookEvent')
      .mockResolvedValue(true);

    const result = await service.handleRazorpayWebhook(
      'test',
      makeRawWebhookBody('customer.created'),
      'signature',
      'evt_header_456'
    );

    expect(result).toEqual({ received: true, handled: false });
    expect(markSpy).toHaveBeenCalledWith('test', 'evt_header_456', 'ignored', null);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('marks handled Razorpay events failed and rethrows processing failures', async () => {
    const service = RazorpayWebhookService.getInstance();
    vi.spyOn(service, 'recordWebhookEventStart').mockResolvedValue({
      shouldProcess: true,
      row: makeWebhookRow(),
    });
    const markSpy = vi.spyOn(service, 'markWebhookEvent').mockResolvedValue(makeWebhookRow());
    vi.spyOn(getServiceInternals(service), 'applyRazorpayWebhookEvent').mockRejectedValue(
      new Error('handler failed')
    );

    await expect(
      service.handleRazorpayWebhook(
        'test',
        makeRawWebhookBody('payment.captured'),
        'signature',
        'evt_header_789'
      )
    ).rejects.toThrow('handler failed');

    expect(markSpy).toHaveBeenCalledWith('test', 'evt_header_789', 'failed', 'handler failed');
  });

  it('records new Razorpay webhook events for processing', async () => {
    const service = RazorpayWebhookService.getInstance();
    mockPool.query.mockResolvedValueOnce({
      rows: [makeWebhookRow({ eventId: 'evt_new_123', eventType: 'payment.captured' })],
      rowCount: 1,
    });

    const result = await service.recordWebhookEventStart(
      'test',
      'evt_new_123',
      'payment.captured',
      makeWebhookPayload('payment.captured')
    );

    expect(result).toMatchObject({
      shouldProcess: true,
      row: {
        eventId: 'evt_new_123',
        processingStatus: 'pending',
      },
    });
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.webhook_events[\s\S]*ON CONFLICT \(provider, environment, provider_event_id\) DO NOTHING/i
      ),
      [
        'test',
        'evt_new_123',
        'payment.captured',
        false,
        expect.objectContaining({
          event: 'payment.captured',
        }),
      ]
    );
  });

  it('does not reprocess fresh pending Razorpay webhook duplicates', async () => {
    const service = RazorpayWebhookService.getInstance();
    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          makeWebhookRow({
            eventId: 'evt_pending_123',
            eventType: 'payment.captured',
            processingStatus: 'pending',
          }),
        ],
        rowCount: 1,
      });

    const result = await service.recordWebhookEventStart(
      'test',
      'evt_pending_123',
      'payment.captured',
      makeWebhookPayload('payment.captured')
    );

    expect(result).toMatchObject({
      shouldProcess: false,
      row: {
        eventId: 'evt_pending_123',
        processingStatus: 'pending',
      },
    });
    expect(mockPool.query).toHaveBeenCalledTimes(3);
    expect(mockPool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(
        /UPDATE payments\.webhook_events[\s\S]*processing_status = 'failed'[\s\S]*OR \(processing_status = 'pending' AND updated_at < \$3\)/i
      ),
      [
        'test',
        'evt_pending_123',
        expect.any(Date),
        expect.objectContaining({
          event: 'payment.captured',
        }),
      ]
    );
  });

  it('reclaims failed or stale Razorpay webhook events for retry', async () => {
    const service = RazorpayWebhookService.getInstance();
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({
      rows: [
        makeWebhookRow({
          eventId: 'evt_retry_123',
          eventType: 'payment.captured',
          processingStatus: 'pending',
          attemptCount: 2,
          lastError: null,
        }),
      ],
      rowCount: 1,
    });

    const result = await service.recordWebhookEventStart(
      'test',
      'evt_retry_123',
      'payment.captured',
      makeWebhookPayload('payment.captured')
    );

    expect(result).toMatchObject({
      shouldProcess: true,
      row: {
        eventId: 'evt_retry_123',
        processingStatus: 'pending',
        attemptCount: 2,
      },
    });
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  it('materializes invoice-only events into Razorpay transactions', async () => {
    const service = RazorpayWebhookService.getInstance();

    const handled = await getServiceInternals(service).applyRazorpayWebhookEvent('test', {
      entity: 'event',
      account_id: 'acc_123',
      event: 'invoice.expired',
      contains: ['invoice'],
      payload: {
        invoice: {
          entity: {
            id: 'inv_123',
            entity: 'invoice',
            type: 'invoice',
            description: null,
            customer_id: 'cust_123',
            customer_details: {
              id: 'cust_123',
              name: 'Buyer',
              email: 'buyer@example.com',
              contact: null,
            },
            order_id: 'order_123',
            subscription_id: null,
            payment_id: null,
            status: 'expired',
            amount: 5000,
            amount_paid: 0,
            amount_due: 5000,
            currency: 'INR',
            short_url: null,
            notes: {
              insforge_subject_type: 'team',
              insforge_subject_id: 'team_123',
            },
            line_items: [
              {
                id: 'line_123',
                item_id: 'item_123',
                name: 'Setup fee',
                description: null,
                amount: 5000,
                unit_amount: 5000,
                quantity: 1,
                currency: 'INR',
              },
            ],
            paid_at: null,
            cancelled_at: null,
            expired_at: 1780617600,
            issued_at: 1780531200,
            created_at: 1780531200,
          },
        },
      },
      created_at: 1780617600,
    });

    expect(handled).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/WITH refs[\s\S]*INSERT INTO payments\.transactions/i),
      expect.arrayContaining([
        'test',
        'invoice',
        'inv_123',
        'failed_payment',
        'failed',
        'team',
        'team_123',
        'cust_123',
        'buyer@example.com',
        5000,
        'inr',
        'Setup fee',
      ])
    );
  });

  it('preserves invoice context when invoice events include a payment entity', async () => {
    const service = RazorpayWebhookService.getInstance();

    const handled = await getServiceInternals(service).applyRazorpayWebhookEvent('test', {
      entity: 'event',
      account_id: 'acc_123',
      event: 'invoice.paid',
      contains: ['invoice', 'payment', 'subscription'],
      payload: {
        invoice: {
          entity: {
            id: 'inv_123',
            entity: 'invoice',
            type: 'invoice',
            description: 'Subscription invoice',
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
            line_items: [
              {
                id: 'line_123',
                item_id: 'item_123',
                name: 'Pro monthly',
                description: null,
                amount: 5000,
                unit_amount: 5000,
                quantity: 1,
                currency: 'INR',
              },
            ],
            paid_at: 1780617600,
            cancelled_at: null,
            expired_at: null,
            issued_at: 1780531200,
            created_at: 1780531200,
          },
        },
        payment: {
          entity: {
            id: 'pay_123',
            entity: 'payment',
            amount: 5000,
            currency: 'INR',
            status: 'captured',
            order_id: null,
            invoice_id: null,
            international: false,
            method: 'card',
            amount_refunded: 0,
            refund_status: null,
            captured: true,
            description: null,
            card_id: null,
            bank: null,
            wallet: null,
            vpa: null,
            email: 'buyer@example.com',
            contact: null,
            customer_id: 'cust_123',
            notes: {},
            fee: null,
            tax: null,
            error_code: null,
            error_description: null,
            error_source: null,
            error_step: null,
            error_reason: null,
            created_at: 1780617600,
          },
        },
        subscription: {
          entity: {
            id: 'sub_123',
            entity: 'subscription',
            plan_id: 'plan_123',
            customer_id: 'cust_123',
            status: 'active',
            current_start: 1780617600,
            current_end: 1783209600,
            ended_at: null,
            quantity: 1,
            notes: {},
            charge_at: null,
            start_at: null,
            end_at: null,
            total_count: 12,
            auth_attempts: 0,
            paid_count: 1,
            remaining_count: 11,
            short_url: null,
            has_scheduled_changes: false,
            change_scheduled_at: null,
            offer_id: null,
            created_at: 1780531200,
          },
        },
      },
      created_at: 1780617600,
    });

    expect(handled).toBe(true);
    const transactionCall = mockPool.query.mock.calls.find(([sql]) =>
      /WITH refs[\s\S]*INSERT INTO payments\.transactions/i.test(String(sql))
    );
    expect(transactionCall).toBeDefined();

    const transactionParams = transactionCall?.[1];
    expect(Array.isArray(transactionParams)).toBe(true);
    const params = transactionParams as unknown[];
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
        5000,
        'inr',
        'Subscription invoice',
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

  it('preserves existing subscription invoice context when later payment events are sparse', async () => {
    const service = RazorpayWebhookService.getInstance();
    mockPool.query.mockImplementation(async (sql: string) => {
      if (/SELECT\s+type,\s+subject_type AS "subjectType"/i.test(sql)) {
        return {
          rows: [
            {
              type: 'subscription_invoice',
              subjectType: 'team',
              subjectId: 'team_123',
              providerCustomerId: 'cust_123',
              customerEmailSnapshot: 'buyer@example.com',
              relatedObjectIds: {
                payment: 'pay_123',
                invoice: 'inv_123',
                order: 'order_123',
                subscription: 'sub_123',
              },
              description: 'Pro monthly',
            },
          ],
          rowCount: 1,
        };
      }

      return { rows: [], rowCount: 0 };
    });

    const handled = await getServiceInternals(service).applyRazorpayWebhookEvent('test', {
      entity: 'event',
      account_id: 'acc_123',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: 'pay_123',
            entity: 'payment',
            amount: 5000,
            currency: 'INR',
            status: 'captured',
            order_id: null,
            invoice_id: null,
            international: false,
            method: 'card',
            amount_refunded: 0,
            refund_status: null,
            captured: true,
            description: null,
            card_id: null,
            bank: null,
            wallet: null,
            vpa: null,
            email: null,
            contact: null,
            customer_id: null,
            notes: {},
            fee: null,
            tax: null,
            error_code: null,
            error_description: null,
            error_source: null,
            error_step: null,
            error_reason: null,
            created_at: 1780617600,
          },
        },
      },
      created_at: 1780617600,
    });

    expect(handled).toBe(true);
    const transactionCall = mockPool.query.mock.calls.find(([sql]) =>
      /WITH refs[\s\S]*INSERT INTO payments\.transactions/i.test(String(sql))
    );
    expect(transactionCall).toBeDefined();

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
        5000,
        'inr',
        'Pro monthly',
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

  it('records Razorpay refund creation as pending without incrementing blindly', async () => {
    const service = RazorpayWebhookService.getInstance();

    const handled = await getServiceInternals(service).applyRazorpayWebhookEvent('test', {
      entity: 'event',
      account_id: 'acc_123',
      event: 'refund.created',
      contains: ['refund'],
      payload: {
        refund: {
          entity: {
            id: 'rfnd_123',
            entity: 'refund',
            payment_id: 'pay_123',
            amount: 1200,
            currency: 'INR',
            status: 'pending',
            created_at: 1780617600,
          },
        },
      },
      created_at: 1780617600,
    });

    expect(handled).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.transactions/i),
      expect.arrayContaining([
        'test',
        'refund',
        'rfnd_123',
        'payment',
        'pay_123',
        'pending',
        1200,
        1200,
        'inr',
      ])
    );
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /WITH refund_totals[\s\S]*UPDATE payments\.transactions original[\s\S]*related_object_ids = original_context\.related_object_ids \|\| refund\.related_object_ids/i
      ),
      ['test', 'pay_123']
    );
    const executedSql = mockPool.query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(executedSql).not.toContain('amount_refunded = COALESCE(amount_refunded, 0) +');
    expect(executedSql).toContain("AND $7 = 'pending'");
  });

  it('records partially refunded Razorpay payments as partially_refunded', async () => {
    const service = RazorpayWebhookService.getInstance();

    const handled = await getServiceInternals(service).applyRazorpayWebhookEvent('test', {
      entity: 'event',
      account_id: 'acc_123',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: 'pay_partial_123',
            entity: 'payment',
            amount: 5000,
            currency: 'INR',
            status: 'captured',
            order_id: 'order_123',
            invoice_id: null,
            international: false,
            method: 'card',
            amount_refunded: 1200,
            refund_status: 'partial',
            captured: true,
            description: null,
            card_id: null,
            bank: null,
            wallet: null,
            vpa: null,
            email: 'buyer@example.com',
            contact: null,
            customer_id: 'cust_123',
            notes: {
              insforge_subject_type: 'team',
              insforge_subject_id: 'team_123',
            },
            fee: null,
            tax: null,
            error_code: null,
            error_description: null,
            error_source: null,
            error_step: null,
            error_reason: null,
            created_at: 1780617600,
          },
        },
      },
      created_at: 1780617600,
    });

    expect(handled).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/WITH refs[\s\S]*INSERT INTO payments\.transactions/i),
      expect.arrayContaining([
        'test',
        'payment',
        'pay_partial_123',
        'one_time_payment',
        'partially_refunded',
        'team',
        'team_123',
        'cust_123',
        'buyer@example.com',
        5000,
        1200,
        'inr',
      ])
    );
    const transactionSql = mockPool.query.mock.calls.find(([sql]) =>
      /WITH refs[\s\S]*INSERT INTO payments\.transactions/i.test(String(sql))
    )?.[0];
    expect(String(transactionSql)).toMatch(
      /ORDER BY\s+CASE WHEN tx\.provider_object_type = \$2 AND tx\.provider_object_id = \$3 THEN 0 ELSE 1 END,\s+tx\.created_at DESC/i
    );
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /UPDATE payments\.razorpay_orders[\s\S]*SET status = CASE[\s\S]*WHEN \$3 THEN 'paid'[\s\S]*WHEN status = 'paid' THEN status[\s\S]*ELSE 'attempted'[\s\S]*verified_payment_id = CASE[\s\S]*WHEN \$3 THEN COALESCE\(verified_payment_id, \$5\)[\s\S]*ELSE verified_payment_id/i
      ),
      expect.arrayContaining(['test', 'order_123', true, 5000, 'pay_partial_123'])
    );
  });

  it('does not mark a Razorpay order verified from a non-succeeded payment', async () => {
    const service = RazorpayWebhookService.getInstance();

    const handled = await getServiceInternals(service).applyRazorpayWebhookEvent('test', {
      entity: 'event',
      account_id: 'acc_123',
      event: 'payment.failed',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: 'pay_failed_123',
            entity: 'payment',
            amount: 5000,
            currency: 'INR',
            status: 'failed',
            order_id: 'order_123',
            invoice_id: null,
            international: false,
            method: 'card',
            amount_refunded: 0,
            refund_status: null,
            captured: false,
            description: null,
            card_id: null,
            bank: null,
            wallet: null,
            vpa: null,
            email: 'buyer@example.com',
            contact: null,
            customer_id: 'cust_123',
            notes: {},
            fee: null,
            tax: null,
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Payment failed',
            error_source: 'customer',
            error_step: 'payment_authentication',
            error_reason: 'payment_failed',
            created_at: 1780617600,
          },
        },
      },
      created_at: 1780617600,
    });

    expect(handled).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /UPDATE payments\.razorpay_orders[\s\S]*SET status = CASE[\s\S]*WHEN \$3 THEN 'paid'[\s\S]*WHEN status = 'paid' THEN status[\s\S]*ELSE 'attempted'[\s\S]*verified_payment_id = CASE[\s\S]*WHEN \$3 THEN COALESCE\(verified_payment_id, \$5\)[\s\S]*ELSE verified_payment_id/i
      ),
      expect.arrayContaining(['test', 'order_123', false, 5000, 'pay_failed_123'])
    );
  });

  it('preserves a paid Razorpay order when a late authorized payment event arrives', async () => {
    const service = RazorpayWebhookService.getInstance();

    const handled = await getServiceInternals(service).applyRazorpayWebhookEvent('test', {
      entity: 'event',
      account_id: 'acc_123',
      event: 'payment.authorized',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: 'pay_authorized_123',
            entity: 'payment',
            amount: 5000,
            currency: 'INR',
            status: 'authorized',
            order_id: 'order_123',
            invoice_id: null,
            international: false,
            method: 'card',
            amount_refunded: 0,
            refund_status: null,
            captured: false,
            description: null,
            card_id: null,
            bank: null,
            wallet: null,
            vpa: null,
            email: 'buyer@example.com',
            contact: null,
            customer_id: 'cust_123',
            notes: {},
            fee: null,
            tax: null,
            error_code: null,
            error_description: null,
            error_source: null,
            error_step: null,
            error_reason: null,
            created_at: 1780617600,
          },
        },
      },
      created_at: 1780617600,
    });

    expect(handled).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /UPDATE payments\.razorpay_orders[\s\S]*SET status = CASE[\s\S]*WHEN \$3 THEN 'paid'[\s\S]*WHEN status = 'paid' THEN status[\s\S]*ELSE 'attempted'/i
      ),
      expect.arrayContaining(['test', 'order_123', false, 5000, 'pay_authorized_123'])
    );
  });

  it('marks Razorpay refunds as refunded only after refund.processed', async () => {
    const service = RazorpayWebhookService.getInstance();

    const handled = await getServiceInternals(service).applyRazorpayWebhookEvent('test', {
      entity: 'event',
      account_id: 'acc_123',
      event: 'refund.processed',
      contains: ['refund'],
      payload: {
        refund: {
          entity: {
            id: 'rfnd_123',
            entity: 'refund',
            payment_id: 'pay_123',
            amount: 1200,
            currency: 'INR',
            status: 'processed',
            created_at: 1780617600,
            processed_at: 1780617900,
          },
        },
      },
      created_at: 1780617900,
    });

    expect(handled).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.transactions/i),
      expect.arrayContaining([
        'test',
        'refund',
        'rfnd_123',
        'payment',
        'pay_123',
        'refunded',
        1200,
        1200,
        'inr',
      ])
    );
  });
});
