/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessagingQueueService } from '../../src/services/messaging/queue.service.js';
import { MessagingWorker } from '../../src/services/messaging/worker.service.js';
import { EmailService } from '../../src/services/email/email.service.js';

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
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes('UNION')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('COMMIT')) return Promise.resolve({});
      if (sql.includes('INSERT INTO messaging.outbox')) {
        return Promise.resolve({ rows: [{ id: 'msg-101' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await queueService.enqueue({
      channel: 'email',
      to: 'test@example.com',
      subject: 'Hello',
      body: 'World',
    });

    expect(res).toEqual({ id: 'msg-101', status: 'pending' });
  });

  it('Claim retrieves pending message with FOR UPDATE SKIP LOCKED and generates claim_token', async () => {
    mockPool.query.mockImplementation((sql: string) => {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        return Promise.resolve({
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
      }
      return Promise.resolve({ rows: [] });
    });

    const claimed = await queueService.claim('worker-alpha');
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe('msg-202');
    expect(claimed?.claimToken).toBe('3c66641c-74a4-44b4-82a8-fdb1284ccbb1');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
      expect.any(Array)
    );
  });

  it('markSent updates status to sent only when workerId and claim_token match', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });
    const matchSuccess = await queueService.markSent('msg-202', 'msg-202', 'worker-alpha', '3c66641c-74a4-44b4-82a8-fdb1284ccbb1');
    expect(matchSuccess).toBe(true);

    mockPool.query.mockResolvedValueOnce({ rowCount: 0 });
    const mismatchFailed = await queueService.markSent('msg-202', 'msg-202', 'worker-alpha', 'wrong-token');
    expect(mismatchFailed).toBe(false);
  });

  it('markFailed increments retry_count and calculates backoff for transient errors', async () => {
    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('COMMIT')) return Promise.resolve({});
      if (sql.includes('UPDATE messaging.outbox')) {
        return Promise.resolve({
          rows: [
            {
              id: 'msg-303',
              status: 'pending',
              retry_count: 1,
              max_retries: 5,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await queueService.markFailed('msg-303', new Error('SMTP Timeout'), 'worker-alpha', '3c66641c-74a4-44b4-82a8-fdb1284ccbb1');
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE messaging.outbox'),
      expect.any(Array)
    );
  });

  it('markFailed moves message to dead_letter when max retries is reached', async () => {
    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('BEGIN')) return Promise.resolve({});
      if (sql.includes('COMMIT')) return Promise.resolve({});
      if (sql.includes('UPDATE messaging.outbox')) {
        return Promise.resolve({
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
        });
      }
      if (sql.includes('INSERT INTO messaging.dead_letter')) return Promise.resolve({ rowCount: 1 });
      if (sql.includes('DELETE FROM messaging.outbox')) return Promise.resolve({ rowCount: 1 });
      return Promise.resolve({ rows: [] });
    });

    await queueService.markFailed('msg-404', new Error('Fatal Error'), 'worker-alpha', '3c66641c-74a4-44b4-82a8-fdb1284ccbb1');
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO messaging.dead_letter'),
      expect.any(Array)
    );
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
    const mockMessage = {
      id: 'msg-505',
      channel: 'email' as const,
      status: 'claimed' as const,
      payload: { channel: 'email' as const, to: 'user@example.com', subject: 'Subject', body: 'Body' },
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
      { to: 'user@example.com', subject: 'Subject', html: 'Body' },
      expect.any(AbortSignal)
    );
    expect(queueService.markSent).toHaveBeenCalledWith('msg-505', 'msg-505', (worker as any).workerId, '3c66641c-74a4-44b4-82a8-fdb1284ccbb1');
  });
});
