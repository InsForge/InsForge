import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../../src/services/job-queue.service';

vi.mock('../../src/utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('JobQueue', () => {
  beforeEach(() => {
    JobQueue.resetForTests();
  });

  afterEach(() => {
    JobQueue.resetForTests();
  });

  it('runs jobs asynchronously after enqueue returns', async () => {
    const queue = JobQueue.getInstance({ concurrency: 1 });
    const calls: string[] = [];

    queue.enqueue('email', { email: 'user@example.com' }, () => {
      calls.push('sent');
    });

    expect(calls).toEqual([]);

    await queue.drain();

    expect(calls).toEqual(['sent']);
    expect(queue.getStats()).toMatchObject({
      queued: 0,
      running: 0,
      completed: 1,
      failed: 0,
    });
  });

  it('processes higher priority jobs first', async () => {
    const queue = JobQueue.getInstance({ concurrency: 1 });
    const calls: string[] = [];

    queue.enqueue('low-priority', {}, () => calls.push('low'), { priority: 'low' });
    queue.enqueue('high-priority', {}, () => calls.push('high'), { priority: 'high' });
    queue.enqueue('normal-priority', {}, () => calls.push('normal'), { priority: 'normal' });

    await queue.drain();

    expect(calls).toEqual(['high', 'normal', 'low']);
  });

  it('retries failed jobs with backoff until they succeed', async () => {
    const queue = JobQueue.getInstance({ concurrency: 1 });
    let attempts = 0;

    queue.enqueue(
      'email',
      { email: 'user@example.com' },
      () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('SMTP temporarily unavailable');
        }
      },
      {
        maxAttempts: 3,
        retryDelayMs: 1,
      }
    );

    await queue.drain();

    expect(attempts).toBe(3);
    expect(queue.getStats()).toMatchObject({
      queued: 0,
      running: 0,
      completed: 1,
      failed: 0,
    });
  });

  it('records permanently failed jobs after max attempts', async () => {
    const queue = JobQueue.getInstance({ concurrency: 1 });

    queue.enqueue(
      'email',
      { email: 'user@example.com' },
      () => {
        throw new Error('SMTP down');
      },
      {
        maxAttempts: 2,
        retryDelayMs: 1,
      }
    );

    await queue.drain();

    expect(queue.getStats()).toMatchObject({
      queued: 0,
      running: 0,
      completed: 0,
      failed: 1,
    });
  });

  it('falls back to default concurrency when an explicit value is invalid', async () => {
    const queue = JobQueue.getInstance({ concurrency: 0 });
    const calls: string[] = [];

    queue.enqueue('email', {}, () => calls.push('sent'));

    await queue.drain();

    expect(calls).toEqual(['sent']);
  });

  it('does not retain job payloads in completed history', async () => {
    const queue = JobQueue.getInstance({ concurrency: 1 });

    queue.enqueue('email', { email: 'user@example.com', token: '123456' }, () => undefined);

    await queue.drain();

    const history = (queue as unknown as { history: Array<{ payload?: unknown }> }).history;
    expect(history).toHaveLength(1);
    expect(history[0].payload).toBeUndefined();
  });
});
