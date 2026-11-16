/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessagingQueueService } from '../../src/services/messaging/queue.service.js';
import { MessagingWorker } from '../../src/services/messaging/worker.service.js';
import { EmailService } from '../../src/services/email/email.service.js';
import { OutboxMessage } from '../../src/types/messaging.js';

const mockClient = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  on: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
  end: vi.fn().mockResolvedValue(undefined),
}));

const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn().mockResolvedValue(mockClient),
}));

vi.mock('pg', () => ({
  Client: vi.fn(() => mockClient),
  Pool: vi.fn(() => mockPool),
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
      getConfig: () => ({ host: 'localhost', port: 5432, user: 'postgres', database: 'insforge' }),
    }),
  },
}));

vi.mock('../../src/services/email/email.service.js', () => ({
  EmailService: {
    getInstance: () => ({
      sendRaw: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

describe('Messaging System Phase 1 Consolidated Tests', () => {
  let queueService: MessagingQueueService;
  let emailService: any;
  let worker: MessagingWorker;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockReset();
    mockClient.query.mockReset();
    mockPool.connect.mockResolvedValue(mockClient);

    queueService = new MessagingQueueService({ getPool: () => mockPool } as any);
    emailService = EmailService.getInstance();
    worker = new MessagingWorker(queueService, emailService);
  });

  it('Enqueue inserts message into outbox with status pending', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'msg-101' }] });

    const res = await queueService.enqueue({
      channel: 'email',
      to: 'test@example.com',
      subject: 'Hello',
      body: 'World',
    });

    expect(res).toEqual({ id: 'msg-101', status: 'pending' });
  });

  it('Claim retrieves pending message with FOR UPDATE SKIP LOCKED and generates claim_token', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'msg-202',
          channel: 'email',
          status: 'claimed',
          payload: { channel: 'email', to: 'user@example.com', subject: 'Hi', body: 'Body' },
          claim_token: '3c66641c-74a4-44b4-82a8-fdb1284ccbb1',
          retry_count: 0,
          max_retries: 5,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    });

    const claimed = await queueService.claim('worker-alpha');
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe('msg-202');
    expect(claimed?.claimToken).toBe('3c66641c-74a4-44b4-82a8-fdb1284ccbb1');
  });

  it('markSent updates status to sent only when workerId and claim_token match', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });
    const matchSuccess = await queueService.markSent(
      'msg-202',
      'msg-202',
      'worker-alpha',
      '3c66641c-74a4-44b4-82a8-fdb1284ccbb1'
    );
    expect(matchSuccess).toBe(true);

    mockPool.query.mockResolvedValueOnce({ rowCount: 0 });
    const mismatchFailed = await queueService.markSent(
      'msg-202',
      'msg-202',
      'worker-alpha',
      'wrong-token'
    );
    expect(mismatchFailed).toBe(false);
  });

  it('markFailed increments retry_count and calculates backoff for transient errors', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'msg-303',
            status: 'pending',
            retry_count: 1,
            max_retries: 5,
          },
        ],
      }) // UPDATE
      .mockResolvedValueOnce({}); // COMMIT

    await queueService.markFailed(
      'msg-303',
      new Error('SMTP Timeout'),
      'worker-alpha',
      '3c66641c-74a4-44b4-82a8-fdb1284ccbb1'
    );
    expect(mockClient.query).toHaveBeenCalledTimes(3);
  });

  it('markFailed moves message to dead_letter when max retries is reached', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'msg-404',
            status: 'dead',
            retry_count: 5,
            max_retries: 5,
            channel: 'email',
            payload: { to: 'user@example.com' },
            created_at: new Date(),
          },
        ],
      }) // UPDATE
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT dead_letter
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE outbox
      .mockResolvedValueOnce({}); // COMMIT

    await queueService.markFailed(
      'msg-404',
      new Error('Fatal Error'),
      'worker-alpha',
      '3c66641c-74a4-44b4-82a8-fdb1284ccbb1'
    );
    expect(mockClient.query).toHaveBeenCalledTimes(5);
  });

  it('Reconciliation recovers orphaned leases via messaging.reconcile_jobs SQL function', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await queueService.reconcile(5, 0.2);
    expect(mockPool.query).toHaveBeenCalledWith(
      'SELECT messaging.reconcile_jobs($1, $2);',
      [5, 0.2]
    );
  });

  it('Worker receives notification and dispatches job via emailService.sendRaw()', async () => {
    const mockMessage: OutboxMessage = {
      id: 'msg-505',
      channel: 'email' as const,
      status: 'claimed' as const,
      payload: {
        channel: 'email' as const,
        to: 'user@example.com',
        subject: 'Subject',
        body: 'Body',
      },
      claimToken: '3c66641c-74a4-44b4-82a8-fdb1284ccbb1',
      retryCount: 0,
      maxRetries: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(queueService, 'renewLease').mockResolvedValue(true);
    vi.spyOn(queueService, 'markSent').mockResolvedValue(true);

    await (worker as any).processMessage(mockMessage);

    expect(emailService.sendRaw).toHaveBeenCalledWith(
      { to: 'user@example.com', subject: 'Subject', html: 'Body', idempotencyKey: 'msg-505' },
      expect.any(AbortSignal)
    );
    expect(queueService.markSent).toHaveBeenCalledWith(
      'msg-505',
      'msg-505',
      (worker as any).workerId,
      '3c66641c-74a4-44b4-82a8-fdb1284ccbb1'
    );
  });

  it('Enqueue handles atomic CTE idempotency key conflict with 409 error on different payload', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'msg-existing-1',
          status: 'pending',
          payload: { channel: 'email', to: 'test@example.com', subject: 'Old', body: 'Old' },
          created_at: new Date(),
          is_new: false,
          is_dead: false,
        },
      ],
    });

    await expect(
      queueService.enqueue({
        channel: 'email',
        to: 'test@example.com',
        subject: 'New',
        body: 'New',
        idempotencyKey: 'idemp-key-1',
      })
    ).rejects.toThrow('Idempotency key conflict: different payload');
  });

  it('Worker respects maxConcurrency limits when multiple polls trigger', async () => {
    (worker as any).isRunning = true;
    (worker as any).activeProcessingCount = 5;
    (worker as any).maxConcurrency = 5;
    vi.spyOn(queueService, 'claim');

    await (worker as any).poll();
    expect(queueService.claim).not.toHaveBeenCalled();
  });

  it('Worker throttles reconciliation calls based on interval', async () => {
    (worker as any).lastReconciledAt = Date.now();
    vi.spyOn(queueService, 'reconcile');

    await (worker as any).reconcileIfNeeded();
    expect(queueService.reconcile).not.toHaveBeenCalled();
  });

  it('Enqueue returns dead status and isDuplicate when idempotency key exists in dead_letter', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'msg-dead-1',
          status: 'dead',
          payload: { channel: 'email', to: 'test@example.com', subject: 'Same', body: 'Same' },
          created_at: new Date(),
          is_new: false,
          is_dead: true,
        },
      ],
    });

    const res = await queueService.enqueue({
      channel: 'email',
      to: 'test@example.com',
      subject: 'Same',
      body: 'Same',
      idempotencyKey: 'idemp-key-dead',
    });

    expect(res).toEqual({
      id: 'msg-dead-1',
      status: 'dead',
      isDuplicate: true,
    });
  });

  it('Enqueue fallback: CTE empty -> re-query outbox matching row -> returns existing record', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // CTE empty
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'msg-fallback-1',
            status: 'pending',
            payload: { channel: 'email', to: 'test@example.com', subject: 'Same', body: 'Same' },
          },
        ],
      }); // outbox re-query

    const res = await queueService.enqueue({
      channel: 'email',
      to: 'test@example.com',
      subject: 'Same',
      body: 'Same',
      idempotencyKey: 'idemp-fallback-1',
    });

    expect(res).toEqual({
      id: 'msg-fallback-1',
      status: 'pending',
      isDuplicate: true,
    });
  });

  it('Enqueue fallback: CTE empty -> re-query outbox different payload -> throws 409', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // CTE empty
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'msg-fallback-1',
            status: 'pending',
            payload: { channel: 'email', to: 'test@example.com', subject: 'Old', body: 'Old' },
          },
        ],
      }); // outbox re-query

    await expect(
      queueService.enqueue({
        channel: 'email',
        to: 'test@example.com',
        subject: 'New',
        body: 'New',
        idempotencyKey: 'idemp-fallback-2',
      })
    ).rejects.toThrow('Idempotency key conflict: different payload');
  });

  it('Enqueue fallback: CTE empty -> outbox empty -> dead_letter query finds row -> returns dead record via resolveEnqueueResult', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // CTE empty
      .mockResolvedValueOnce({ rows: [] }) // outbox re-query empty
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'msg-dead-fallback',
            status: 'dead',
            payload: { channel: 'email', to: 'test@example.com', subject: 'Same', body: 'Same' },
            is_dead: true,
          },
        ],
      }); // dead_letter re-query

    const res = await queueService.enqueue({
      channel: 'email',
      to: 'test@example.com',
      subject: 'Same',
      body: 'Same',
      idempotencyKey: 'idemp-fallback-dead',
    });

    expect(res).toEqual({
      id: 'msg-dead-fallback',
      status: 'dead',
      isDuplicate: true,
    });
  });

  it('Enqueue fallback: CTE empty -> outbox empty -> dead_letter empty -> throws 409 concurrent in progress', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // CTE empty
      .mockResolvedValueOnce({ rows: [] }) // outbox empty
      .mockResolvedValueOnce({ rows: [] }); // dead_letter empty

    await expect(
      queueService.enqueue({
        channel: 'email',
        to: 'test@example.com',
        subject: 'Same',
        body: 'Same',
        idempotencyKey: 'idemp-fallback-empty',
      })
    ).rejects.toThrow('Idempotency key conflict: concurrent request in progress');
  });

  it('Worker skips sendRaw and calls markSent when delivery_attempts records sent', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'sent' }] });

    const mockMessage: OutboxMessage = {
      id: 'msg-audit-sent',
      channel: 'email' as const,
      status: 'claimed' as const,
      payload: { channel: 'email' as const, to: 'user@example.com', subject: 'Sub', body: 'Body' },
      claimedBy: (worker as any).workerId,
      claimedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
      claimToken: 'audit-claim-token',
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(queueService, 'markSent').mockResolvedValue(true);
    vi.spyOn(emailService, 'sendRaw');

    await (worker as any).processMessage(mockMessage);

    expect(emailService.sendRaw).not.toHaveBeenCalled();
    expect(queueService.markSent).toHaveBeenCalledWith(
      'msg-audit-sent',
      'msg-audit-sent',
      (worker as any).workerId,
      'audit-claim-token'
    );
  });

  it('Worker start continues in polling fallback mode on setupListenClient failure', async () => {
    const errorClient = {
      query: vi.fn(),
      on: vi.fn(),
      connect: vi.fn().mockRejectedValue(new Error('DB Connection Refused')),
      end: vi.fn().mockResolvedValue(undefined),
    };
    const { Client } = await import('pg');
    (Client as any).mockImplementationOnce(function () {
      return errorClient;
    });

    await expect(worker.start()).resolves.toBeUndefined();
    expect((worker as any).isRunning).toBe(true);
    expect((worker as any).pollInterval).not.toBeNull();
    await worker.stop();
  });
});
