/**
 * Behavioral coverage for the Paystack ledger's terminal-state guards,
 * exercised against a real Postgres seeded with the full migration chain
 * (including 060's status-constraint management).
 *
 * The unit suite asserts the SQL text; this suite asserts the behavior the
 * SQL must deliver: a delayed charge.success arriving after a reversal must
 * not restore a refunded ledger row to succeeded or zero its refunded amount.
 */
import { PgTestClient } from 'insforge-test';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { PaystackTransactionResource } from '../../src/providers/payments/paystack.provider';
import { getConnections } from './utils';

let db: PgTestClient;
let teardown: () => Promise<void>;

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      // The service only calls pool.query(); PgTestClient is query-compatible.
      getPool: () => db,
    }),
  },
}));

import { PaystackTransactionService } from '../../src/services/payments/paystack/transaction.service';

function providerTransaction(
  status: PaystackTransactionResource['status']
): PaystackTransactionResource {
  return {
    id: 987654321,
    domain: 'test',
    status,
    reference: 'ps_ref_ledger_test',
    amount: 500000,
    currency: 'NGN',
    gateway_response: null,
    channel: 'card',
    message: null,
    ip_address: null,
    fees: null,
    paid_at: '2026-07-01T10:00:00.000Z',
    created_at: '2026-07-01T09:59:00.000Z',
    metadata: { insforge_transaction_id: 'local_txn_ledger_test' },
    customer: {
      id: 1,
      customer_code: 'CUS_ledger_test',
      email: 'ledger@example.com',
      first_name: null,
      last_name: null,
    },
    authorization: null,
  };
}

async function ledgerRow() {
  const { rows } = await db.query(
    `SELECT status, amount, amount_refunded AS "amountRefunded",
            paid_at AS "paidAt", refunded_at AS "refundedAt"
     FROM payments.transactions
     WHERE provider = 'paystack'
       AND related_object_ids->>'reference' = 'ps_ref_ledger_test'`
  );
  expect(rows).toHaveLength(1);
  return rows[0] as {
    status: string;
    amount: string;
    amountRefunded: string;
    paidAt: Date | null;
    refundedAt: Date | null;
  };
}

const chargeOptions = { subjectFallback: { type: 'user', id: 'user_ledger_test' } };

beforeAll(async () => {
  ({ db, teardown } = await getConnections());
}, 120_000);

afterAll(() => teardown());

describe('paystack ledger terminal states (behavioral)', () => {
  it('migration 060 accepts the reversed session status', async () => {
    await db.query(
      `INSERT INTO payments.paystack_transactions (environment, status, amount, currency)
       VALUES ('test', 'reversed', 1000, 'ngn')`
    );
    const { rows } = await db.query(
      `SELECT status FROM payments.paystack_transactions WHERE status = 'reversed'`
    );
    expect(rows).toHaveLength(1);
  });

  it('a delayed charge.success cannot un-refund a reversed ledger row', async () => {
    const service = PaystackTransactionService.getInstance();

    // 1. Normal success projects a succeeded charge.
    await service.upsertChargeTransaction('test', providerTransaction('success'), chargeOptions);
    let row = await ledgerRow();
    expect(row.status).toBe('succeeded');
    expect(Number(row.amountRefunded)).toBe(0);

    // 2. Re-verify after a refund/chargeback: reversed → terminal refunded.
    await service.upsertChargeTransaction('test', providerTransaction('reversed'), chargeOptions);
    row = await ledgerRow();
    expect(row.status).toBe('refunded');
    expect(Number(row.amountRefunded)).toBe(500000);
    expect(row.refundedAt).not.toBeNull();

    // 3. Delayed charge.success webhook replays the old success payload.
    await service.upsertChargeTransaction('test', providerTransaction('success'), chargeOptions);
    row = await ledgerRow();
    expect(row.status).toBe('refunded');
    expect(Number(row.amountRefunded)).toBe(500000);
    expect(row.refundedAt).not.toBeNull();

    // 4. Stale pending cannot downgrade the terminal row either.
    await service.upsertChargeTransaction('test', providerTransaction('pending'), chargeOptions);
    row = await ledgerRow();
    expect(row.status).toBe('refunded');
  });
});
