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
      'ps_ref_123'
    );

    // Server-side verify only: the provider is asked for the transaction by reference.
    expect(mockVerifyTransaction).toHaveBeenCalledWith('ps_ref_123');
    expect(mockPoolQuery).toHaveBeenNthCalledWith(
      1,
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
      PaystackTransactionService.getInstance().verifyTransaction('test', 'ps_ref_missing')
    ).rejects.toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.PAYMENT_NOT_FOUND,
    });

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });
});
