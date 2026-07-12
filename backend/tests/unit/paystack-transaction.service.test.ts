import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import type { PaystackTransactionResource } from '../../src/providers/payments/paystack.provider';

const {
  mockPoolQuery,
  mockUserClientQuery,
  mockInitializeTransaction,
  mockVerifyTransaction,
  mockCreatePaystackProvider,
  mockGetPaystackPublicKey,
  mockWithUserContext,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockUserClientQuery: vi.fn(),
  mockInitializeTransaction: vi.fn(),
  mockVerifyTransaction: vi.fn(),
  mockCreatePaystackProvider: vi.fn(),
  mockGetPaystackPublicKey: vi.fn(),
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

vi.mock('../../src/services/payments/paystack/config.service', () => ({
  PaystackConfigService: {
    getInstance: () => ({
      createPaystackProvider: mockCreatePaystackProvider,
      getPaystackPublicKey: mockGetPaystackPublicKey,
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

import { PaystackTransactionService } from '../../src/services/payments/paystack/transaction.service';

function buildTransactionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'local_txn_123',
    environment: 'test',
    status: 'pending',
    subjectType: 'team',
    subjectId: 'team_123',
    customerEmail: 'buyer@example.com',
    reference: 'ps_ref_123',
    accessCode: 'access_abc',
    authorizationUrl: 'https://checkout.paystack.com/abc',
    amount: 500000,
    currency: 'ngn',
    verifiedTransactionId: null,
    verifiedAt: null,
    metadata: {
      insforge_subject_type: 'team',
      insforge_subject_id: 'team_123',
      insforge_transaction_id: 'local_txn_123',
    },
    lastError: null,
    createdAt: new Date('2026-07-01T09:58:00.000Z'),
    updatedAt: new Date('2026-07-01T09:59:00.000Z'),
    ...overrides,
  };
}

function buildProviderTransaction(
  overrides: Partial<PaystackTransactionResource> = {}
): PaystackTransactionResource {
  return {
    id: 12345,
    domain: 'test',
    status: 'success',
    reference: 'ps_ref_123',
    amount: 500000,
    currency: 'NGN',
    gateway_response: 'Successful',
    channel: 'card',
    message: null,
    ip_address: null,
    fees: 7500,
    paid_at: '2026-07-01T10:00:00.000Z',
    created_at: '2026-07-01T09:59:00.000Z',
    metadata: {
      insforge_subject_type: 'team',
      insforge_subject_id: 'team_123',
      insforge_transaction_id: 'local_txn_123',
    },
    customer: {
      id: 99,
      customer_code: 'CUS_123',
      email: 'buyer@example.com',
      first_name: 'Buyer',
      last_name: 'Example',
    },
    authorization: {
      authorization_code: 'AUTH_abc',
      card_type: 'visa',
      last4: '4242',
      bank: null,
      channel: 'card',
      reusable: true,
    },
    ...overrides,
  };
}

const AUTHENTICATED_USER = {
  role: 'authenticated',
  id: 'user_123',
  email: 'buyer@example.com',
} as const;

describe('PaystackTransactionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithUserContext.mockImplementation(async (_pool, _user, task) =>
      task({ query: mockUserClientQuery })
    );
    mockCreatePaystackProvider.mockResolvedValue({
      initializeTransaction: mockInitializeTransaction,
      verifyTransaction: mockVerifyTransaction,
    });
    mockGetPaystackPublicKey.mockResolvedValue('pk_test_public');
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockUserClientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('initializes a transaction under RLS and promotes it to pending with provider results', async () => {
    mockInitializeTransaction.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/abc',
      access_code: 'access_abc',
      reference: 'ps_ref_123',
    });
    mockPoolQuery.mockResolvedValueOnce({ rows: [buildTransactionRow()], rowCount: 1 });

    const result = await PaystackTransactionService.getInstance().initializeTransaction(
      'test',
      {
        amount: 500000,
        currency: 'NGN',
        email: 'buyer@example.com',
        subject: { type: 'team', id: 'team_123' },
      },
      AUTHENTICATED_USER
    );

    expect(mockUserClientQuery).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.paystack_transactions[\s\S]*VALUES \(\$1, \$2, 'initialized'/i
      ),
      [
        expect.any(String),
        'test',
        'team',
        'team_123',
        'buyer@example.com',
        AUTHENTICATED_USER.id,
        null,
        500000,
        'ngn',
        null,
        JSON.stringify({
          insforge_subject_type: 'team',
          insforge_subject_id: 'team_123',
        }),
      ]
    );
    expect(mockInitializeTransaction).toHaveBeenCalledWith({
      amount: 500000,
      currency: 'NGN',
      email: 'buyer@example.com',
      reference: null,
      callbackUrl: null,
      metadata: {
        insforge_subject_type: 'team',
        insforge_subject_id: 'team_123',
        insforge_transaction_id: expect.any(String),
      },
    });
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE payments\.paystack_transactions[\s\S]*SET status = 'pending'/i),
      [
        expect.any(String),
        'ps_ref_123',
        'access_abc',
        'https://checkout.paystack.com/abc',
        expect.objectContaining({ insforge_transaction_id: expect.any(String) }),
        expect.objectContaining({ reference: 'ps_ref_123' }),
      ]
    );
    expect(result).toEqual(
      expect.objectContaining({
        authorizationUrl: 'https://checkout.paystack.com/abc',
        accessCode: 'access_abc',
        reference: 'ps_ref_123',
        publicKey: 'pk_test_public',
        transaction: expect.objectContaining({ status: 'pending', reference: 'ps_ref_123' }),
      })
    );
  });

  it('marks the local row failed when the provider initialize call fails', async () => {
    mockInitializeTransaction.mockRejectedValue(new Error('paystack unavailable'));
    mockPoolQuery.mockResolvedValueOnce({
      rows: [buildTransactionRow({ status: 'failed', lastError: 'paystack unavailable' })],
      rowCount: 1,
    });

    await expect(
      PaystackTransactionService.getInstance().initializeTransaction(
        'test',
        { amount: 500000, currency: 'NGN', email: 'buyer@example.com' },
        AUTHENTICATED_USER
      )
    ).rejects.toThrow('paystack unavailable');

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE payments\.paystack_transactions[\s\S]*SET status = 'failed'/i),
      [expect.any(String), 'paystack unavailable']
    );
  });

  it('maps RLS permission errors on insert to a 403 without calling the provider', async () => {
    mockUserClientQuery.mockRejectedValueOnce({ code: '42501' });

    await expect(
      PaystackTransactionService.getInstance().initializeTransaction(
        'test',
        { amount: 500000, currency: 'NGN', email: 'buyer@example.com' },
        AUTHENTICATED_USER
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.AUTH_UNAUTHORIZED,
    });

    expect(mockCreatePaystackProvider).not.toHaveBeenCalled();
    expect(mockInitializeTransaction).not.toHaveBeenCalled();
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('verifies server-side, updates the local row, and projects the shared transaction', async () => {
    const transaction = buildProviderTransaction();
    mockVerifyTransaction.mockResolvedValue(transaction);
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'local_txn_123', created_by: AUTHENTICATED_USER.id }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          buildTransactionRow({
            status: 'success',
            verifiedTransactionId: '12345',
            verifiedAt: new Date('2026-07-01T10:00:05.000Z'),
          }),
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await PaystackTransactionService.getInstance().verifyTransaction(
      'test',
      'ps_ref_123',
      AUTHENTICATED_USER
    );

    // Ownership is checked before the provider or any row mutation.
    expect(mockPoolQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/SELECT id, created_by[\s\S]*FROM payments\.paystack_transactions/i),
      ['test', 'ps_ref_123']
    );
    // Server-side verify only: the provider is asked for the transaction by reference.
    expect(mockVerifyTransaction).toHaveBeenCalledWith('ps_ref_123');
    expect(mockPoolQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(
        /UPDATE payments\.paystack_transactions[\s\S]*verified_transaction_id = COALESCE\(verified_transaction_id, \$4\)/i
      ),
      ['test', 'ps_ref_123', 'success', '12345', true, transaction]
    );
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringMatching(
        /WITH refs[\s\S]*tx\.provider = 'paystack'[\s\S]*INSERT INTO payments\.transactions/i
      ),
      expect.arrayContaining([
        'test',
        'transaction',
        '12345',
        'one_time_payment',
        'succeeded',
        'team',
        'team_123',
        'CUS_123',
        'buyer@example.com',
        500000,
        'ngn',
        new Date('2026-07-01T10:00:00.000Z'),
      ])
    );
    const upsertCall = mockPoolQuery.mock.calls.find(([sql]) =>
      /INSERT INTO payments\.transactions/i.test(String(sql))
    );
    const params = upsertCall?.[1] as unknown[];
    expect(JSON.parse(String(params[11]))).toEqual({
      transaction: '12345',
      reference: 'ps_ref_123',
    });
    expect(JSON.parse(String(params[21]))).toEqual([
      { type: 'transaction', id: '12345' },
      { type: 'reference', id: 'ps_ref_123' },
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        verified: true,
        transaction: expect.objectContaining({
          status: 'success',
          verifiedTransactionId: '12345',
        }),
      })
    );
  });

  it('raises 404 for verify of an unknown reference without projecting a transaction', async () => {
    mockVerifyTransaction.mockResolvedValue(buildProviderTransaction());
    mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      PaystackTransactionService.getInstance().verifyTransaction(
        'test',
        'ps_ref_missing',
        AUTHENTICATED_USER
      )
    ).rejects.toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.PAYMENT_NOT_FOUND,
    });

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(mockVerifyTransaction).not.toHaveBeenCalled();
  });

  it('raises 404 for verify by a non-owner without calling the provider or mutating', async () => {
    mockVerifyTransaction.mockResolvedValue(buildProviderTransaction());
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: 'local_txn_123', created_by: 'someone_else' }],
      rowCount: 1,
    });

    await expect(
      PaystackTransactionService.getInstance().verifyTransaction(
        'test',
        'ps_ref_123',
        AUTHENTICATED_USER
      )
    ).rejects.toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.PAYMENT_NOT_FOUND,
    });

    expect(mockVerifyTransaction).not.toHaveBeenCalled();
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it('verifies anon-created rows only with the local transaction id, and lets admins verify any row', async () => {
    const transaction = buildProviderTransaction();
    mockVerifyTransaction.mockResolvedValue(transaction);
    // Anon-created row + correct local transaction id.
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 'local_txn_123', created_by: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buildTransactionRow({ status: 'success' })], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      PaystackTransactionService.getInstance().verifyTransaction(
        'test',
        'ps_ref_123',
        AUTHENTICATED_USER,
        'local_txn_123'
      )
    ).resolves.toMatchObject({ verified: true });

    // Anon-created row without the id: rejected before the provider is called.
    mockVerifyTransaction.mockClear();
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: 'local_txn_123', created_by: null }],
      rowCount: 1,
    });

    await expect(
      PaystackTransactionService.getInstance().verifyTransaction(
        'test',
        'ps_ref_123',
        AUTHENTICATED_USER
      )
    ).rejects.toMatchObject({ statusCode: 404, code: ERROR_CODES.PAYMENT_NOT_FOUND });
    expect(mockVerifyTransaction).not.toHaveBeenCalled();

    // Owned row, admin caller.
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'local_txn_123', created_by: 'someone_else' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [buildTransactionRow({ status: 'success' })], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      PaystackTransactionService.getInstance().verifyTransaction('test', 'ps_ref_123', {
        role: 'project_admin',
        id: 'admin_1',
      })
    ).resolves.toMatchObject({ verified: true });
  });

  it('rejects verification when the provider transaction does not echo the local row id', async () => {
    // The row exists and the caller owns it, but the Paystack transaction the
    // reference resolves to was not created by this row (foreign reference).
    mockVerifyTransaction.mockResolvedValue(
      buildProviderTransaction({ metadata: { insforge_transaction_id: 'someone_elses_row' } })
    );
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: 'local_txn_123', created_by: AUTHENTICATED_USER.id }],
      rowCount: 1,
    });

    await expect(
      PaystackTransactionService.getInstance().verifyTransaction(
        'test',
        'ps_ref_123',
        AUTHENTICATED_USER
      )
    ).rejects.toMatchObject({ statusCode: 404, code: ERROR_CODES.PAYMENT_NOT_FOUND });

    // The local row and shared ledger are never touched.
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it('projects a processed refund into the shared ledger and refreshes the original charge', async () => {
    const refund = {
      id: 777,
      transaction: 12345,
      amount: 200000,
      currency: 'NGN',
      status: 'processed',
      created_at: '2026-07-02T10:00:00.000Z',
    };

    await PaystackTransactionService.getInstance().upsertRefundTransaction(
      'test',
      refund,
      'refunded'
    );

    expect(mockPoolQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(
        /WITH refs[\s\S]*tx\.provider = 'paystack'[\s\S]*INSERT INTO payments\.transactions/i
      ),
      [
        'test',
        'refund',
        '777',
        'transaction',
        '12345',
        'refund',
        'refunded',
        null,
        null,
        null,
        null,
        JSON.stringify({ refund: '777', transaction: '12345' }),
        200000,
        200000,
        'ngn',
        null,
        null,
        null,
        new Date('2026-07-02T10:00:00.000Z'),
        new Date('2026-07-02T10:00:00.000Z'),
        refund,
        JSON.stringify([{ type: 'refund', id: '777' }]),
      ]
    );
    // The original charge's refunded amount/status is recomputed afterwards.
    expect(mockPoolQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(
        /WITH refund_totals[\s\S]*provider = 'paystack'[\s\S]*type = 'refund'/i
      ),
      ['test', '12345', null]
    );
  });

  it('projects a failed refund keyed by transaction reference', async () => {
    const refund = {
      id: 888,
      transaction: 'ps_ref_123',
      amount: 1200,
      currency: 'NGN',
      status: 'failed',
      created_at: '2026-07-02T10:00:00.000Z',
    };

    await PaystackTransactionService.getInstance().upsertRefundTransaction(
      'test',
      refund,
      'failed'
    );

    const [, params] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe('refund'); // provider object type
    expect(params[2]).toBe('888'); // provider object id
    // A reference-only refund has no parent transaction id to attach.
    expect(params[3]).toBeNull();
    expect(params[4]).toBeNull();
    expect(params[6]).toBe('failed'); // ledger status
    expect(JSON.parse(String(params[11]))).toEqual({
      refund: '888',
      reference: 'ps_ref_123',
    });
    expect(params[17]).toEqual(new Date('2026-07-02T10:00:00.000Z')); // failedAt
    expect(params[18]).toBeNull(); // refundedAt
    expect(mockPoolQuery).toHaveBeenNthCalledWith(2, expect.stringMatching(/WITH refund_totals/i), [
      'test',
      null,
      'ps_ref_123',
    ]);
  });

  it('extracts the origin transaction from an embedded transaction object', async () => {
    const refund = {
      id: 999,
      transaction: { id: 12345, reference: 'ps_ref_123' },
      amount: 500,
      currency: 'NGN',
      status: 'processed',
      created_at: '2026-07-02T10:00:00.000Z',
    };

    await PaystackTransactionService.getInstance().upsertRefundTransaction(
      'test',
      refund,
      'refunded'
    );

    const [, params] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBe('transaction');
    expect(params[4]).toBe('12345');
    expect(JSON.parse(String(params[11]))).toEqual({
      refund: '999',
      transaction: '12345',
      reference: 'ps_ref_123',
    });
    expect(mockPoolQuery).toHaveBeenNthCalledWith(2, expect.stringMatching(/WITH refund_totals/i), [
      'test',
      '12345',
      'ps_ref_123',
    ]);
  });

  it('skips the original-charge refresh when the refund names no transaction', async () => {
    const refund = {
      id: 1000,
      transaction: null,
      amount: 500,
      currency: 'NGN',
      status: 'processed',
      created_at: '2026-07-02T10:00:00.000Z',
    };

    await PaystackTransactionService.getInstance().upsertRefundTransaction(
      'test',
      refund,
      'refunded'
    );

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(String(mockPoolQuery.mock.calls[0][0])).not.toMatch(/WITH refund_totals/i);
  });
});
