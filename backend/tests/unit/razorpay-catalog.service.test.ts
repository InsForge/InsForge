import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockPoolQuery,
  mockCreateItem,
  mockUpdateItem,
  mockCreatePlan,
  mockCreateRazorpayProvider,
  mockWithPaymentSessionAdvisoryLock,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockCreateItem: vi.fn(),
  mockUpdateItem: vi.fn(),
  mockCreatePlan: vi.fn(),
  mockCreateRazorpayProvider: vi.fn(),
  mockWithPaymentSessionAdvisoryLock: vi.fn(),
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

vi.mock('../../src/services/payments/payments-advisory-lock', () => ({
  withPaymentSessionAdvisoryLock: mockWithPaymentSessionAdvisoryLock,
}));

vi.mock('../../src/services/payments/razorpay/config.service', () => ({
  RazorpayConfigService: {
    getInstance: () => ({
      createRazorpayProvider: mockCreateRazorpayProvider,
    }),
  },
}));

import { RazorpayCatalogService } from '../../src/services/payments/razorpay/catalog.service';

describe('RazorpayCatalogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithPaymentSessionAdvisoryLock.mockImplementation(async (_pool, _lockName, task) => task());
    mockCreateRazorpayProvider.mockResolvedValue({
      createItem: mockCreateItem,
      updateItem: mockUpdateItem,
      createPlan: mockCreatePlan,
    });
  });

  it('creates and mirrors a native Razorpay item', async () => {
    mockCreateItem.mockResolvedValue({
      id: 'item_123',
      active: true,
      amount: 25000,
      unit_amount: 25000,
      currency: 'INR',
      name: 'Invoice item',
      description: null,
      type: 'invoice',
      created_at: 1767225600,
    });
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await RazorpayCatalogService.getInstance().createItem({
      environment: 'test',
      name: 'Invoice item',
      amount: 25000,
      currency: 'INR',
      metadata: { tier: 'starter' },
    });

    expect(mockCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Invoice item',
        amount: 25000,
        currency: 'INR',
        notes: { tier: 'starter' },
      })
    );
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.razorpay_items/i),
      expect.arrayContaining(['test', 'item_123', 'Invoice item', null, true, 25000, 25000, 'inr'])
    );
    expect(result.item).toEqual(
      expect.objectContaining({
        itemId: 'item_123',
        currency: 'inr',
        metadata: { tier: 'starter' },
      })
    );
  });

  it('creates and mirrors a native Razorpay plan with its embedded item', async () => {
    mockCreatePlan.mockResolvedValue({
      id: 'plan_123',
      entity: 'plan',
      period: 'monthly',
      interval: 1,
      item: {
        id: 'item_plan_123',
        name: 'Pro monthly',
        description: null,
        amount: 199900,
        unit_amount: 199900,
        currency: 'INR',
        active: true,
      },
      notes: { tier: 'pro' },
      created_at: 1767225600,
    });
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await RazorpayCatalogService.getInstance().createPlan({
      environment: 'test',
      period: 'monthly',
      interval: 1,
      item: {
        name: 'Pro monthly',
        amount: 199900,
        currency: 'INR',
      },
      metadata: { tier: 'pro' },
    });

    expect(mockCreatePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        period: 'monthly',
        interval: 1,
        item: expect.objectContaining({
          name: 'Pro monthly',
          amount: 199900,
          currency: 'INR',
        }),
        notes: { tier: 'pro' },
      })
    );
    expect(mockPoolQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/INSERT INTO payments\.razorpay_items/i),
      expect.arrayContaining(['test', 'item_plan_123', 'Pro monthly'])
    );
    expect(mockPoolQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/INSERT INTO payments\.razorpay_plans/i),
      expect.arrayContaining(['test', 'plan_123', 'item_plan_123', 'monthly', 1])
    );
    expect(result.plan).toEqual(
      expect.objectContaining({
        planId: 'plan_123',
        itemId: 'item_plan_123',
        metadata: { tier: 'pro' },
      })
    );
  });
});
