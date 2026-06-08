import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockPoolQuery,
  mockUserClientQuery,
  mockCreateOrder,
  mockVerifyOrderPaymentSignature,
  mockCreateRazorpayProvider,
  mockWithUserContext,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockUserClientQuery: vi.fn(),
  mockCreateOrder: vi.fn(),
  mockVerifyOrderPaymentSignature: vi.fn(),
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

vi.mock('../../src/services/database/user-context.service', () => ({
  withUserContext: mockWithUserContext,
}));

vi.mock('../../src/services/payments/razorpay/config.service', () => ({
  RazorpayConfigService: {
    getInstance: () => ({
      createRazorpayProvider: mockCreateRazorpayProvider,
    }),
  },
}));

import { RazorpayOrderService } from '../../src/services/payments/razorpay/order.service';

function buildOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'local_order_123',
    environment: 'test',
    status: 'created',
    subjectType: 'team',
    subjectId: 'team_123',
    customerName: 'Buyer',
    customerEmail: 'buyer@example.com',
    customerContact: '+919999999999',
    orderId: 'order_123',
    receipt: 'receipt_123',
    amount: 50000,
    amountPaid: 0,
    amountDue: 50000,
    currency: 'inr',
    attempts: 0,
    verifiedPaymentId: null,
    verifiedAt: null,
    lastError: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('RazorpayOrderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithUserContext.mockImplementation(async (_pool, _user, task) =>
      task({ query: mockUserClientQuery })
    );
    mockCreateRazorpayProvider.mockResolvedValue({
      getKeyId: () => 'rzp_test_key',
      createOrder: mockCreateOrder,
      verifyOrderPaymentSignature: mockVerifyOrderPaymentSignature,
    });
  });

  it('creates a native Razorpay order with subject metadata for Checkout', async () => {
    mockUserClientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    mockCreateOrder.mockResolvedValue({
      id: 'order_123',
      entity: 'order',
      amount: 50000,
      amount_paid: 0,
      amount_due: 50000,
      currency: 'INR',
      receipt: 'receipt_123',
      status: 'created',
      attempts: 0,
      notes: {},
      created_at: 1767225600,
    });
    mockPoolQuery.mockResolvedValueOnce({ rows: [buildOrderRow()], rowCount: 1 });

    const result = await RazorpayOrderService.getInstance().createOrder(
      {
        environment: 'test',
        amount: 50000,
        currency: 'INR',
        receipt: 'receipt_123',
        description: 'Pro upgrade',
        subject: { type: 'team', id: 'team_123' },
        customerName: 'Buyer',
        customerEmail: 'buyer@example.com',
        customerContact: '+919999999999',
      },
      { role: 'authenticated', id: 'user_123', email: 'buyer@example.com' }
    );

    expect(mockUserClientQuery).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.razorpay_orders/i),
      expect.arrayContaining([
        'test',
        'team',
        'team_123',
        'Buyer',
        'buyer@example.com',
        '+919999999999',
        'receipt_123',
        50000,
        'inr',
      ])
    );
    expect(mockCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 50000,
        currency: 'INR',
        receipt: 'receipt_123',
        notes: expect.objectContaining({
          insforge_subject_type: 'team',
          insforge_subject_id: 'team_123',
          insforge_order_id: expect.any(String),
        }),
      })
    );
    expect(result.checkoutOptions).toEqual(
      expect.objectContaining({
        keyId: 'rzp_test_key',
        amount: 50000,
        currency: 'INR',
        orderId: 'order_123',
        description: 'Pro upgrade',
      })
    );
  });

  it('verifies the Razorpay Checkout signature before marking an order verified', async () => {
    mockVerifyOrderPaymentSignature.mockReturnValue(true);
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        buildOrderRow({
          status: 'attempted',
          verifiedPaymentId: 'pay_123',
          verifiedAt: new Date('2026-01-01T00:01:00Z'),
        }),
      ],
      rowCount: 1,
    });

    const result = await RazorpayOrderService.getInstance().verifyOrderPayment({
      environment: 'test',
      orderId: 'order_123',
      paymentId: 'pay_123',
      signature: 'signature',
    });

    expect(mockVerifyOrderPaymentSignature).toHaveBeenCalledWith(
      'order_123',
      'pay_123',
      'signature'
    );
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE payments\.razorpay_orders/i),
      ['test', 'order_123', 'pay_123']
    );
    expect(result).toEqual(
      expect.objectContaining({
        verified: true,
        order: expect.objectContaining({ verifiedPaymentId: 'pay_123' }),
      })
    );
  });

  it('rejects invalid Razorpay Checkout signatures without updating the order', async () => {
    mockVerifyOrderPaymentSignature.mockReturnValue(false);

    await expect(
      RazorpayOrderService.getInstance().verifyOrderPayment({
        environment: 'test',
        orderId: 'order_123',
        paymentId: 'pay_123',
        signature: 'bad',
      })
    ).rejects.toThrow(/Invalid Razorpay payment signature/);

    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});
