import crypto from 'crypto';
import logger from '@/utils/logger.js';

export type JobPriority = 'high' | 'normal' | 'low';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'retrying';

export interface EnqueueJobOptions {
  priority?: JobPriority;
  maxAttempts?: number;
  retryDelayMs?: number;
  retryBackoffMultiplier?: number;
}

export interface JobSnapshot<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  priority: JobPriority;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  runAt: Date;
  lastError?: string;
}

type JobHandler = () => Promise<void> | void;

interface QueuedJob<TPayload = unknown> extends JobSnapshot<TPayload> {
  handler: JobHandler;
  retryDelayMs: number;
  retryBackoffMultiplier: number;
  sequence: number;
}

const PRIORITY_RANK: Record<JobPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_CONCURRENCY = 2;
const MAX_HISTORY = 100;

export class JobQueue {
  private static instance: JobQueue | undefined;

  private readonly concurrency: number;
  private queue: QueuedJob[] = [];
  private history: JobSnapshot[] = [];
  private running = 0;
  private sequence = 0;
  private processScheduled = false;

  private constructor(
    concurrency = readPositiveInteger(process.env.JOB_QUEUE_CONCURRENCY, DEFAULT_CONCURRENCY)
  ) {
    this.concurrency = concurrency;
  }

  public static getInstance(options?: { concurrency?: number }): JobQueue {
    if (!JobQueue.instance) {
      JobQueue.instance = new JobQueue(options?.concurrency);
    }
    return JobQueue.instance;
  }

  public static resetForTests(): void {
    JobQueue.instance?.clear();
    JobQueue.instance = undefined;
  }

  public enqueue<TPayload>(
    type: string,
    payload: TPayload,
    handler: JobHandler,
    options: EnqueueJobOptions = {}
  ): string {
    const now = new Date();
    const job: QueuedJob<TPayload> = {
      id: crypto.randomUUID(),
      type,
      payload,
      handler,
      priority: options.priority ?? 'normal',
      status: 'queued',
      attempts: 0,
      maxAttempts: Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
      retryDelayMs: Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS),
      retryBackoffMultiplier: Math.max(1, options.retryBackoffMultiplier ?? 2),
      createdAt: now,
      updatedAt: now,
      runAt: now,
      sequence: this.sequence++,
    };

    this.queue.push(job);
    logger.debug('Background job queued', {
      jobId: job.id,
      type: job.type,
      priority: job.priority,
      maxAttempts: job.maxAttempts,
    });
    this.scheduleProcess();

    return job.id;
  }

  public getStats(): {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    retrying: number;
  } {
    const queued = this.queue.filter((job) => job.status === 'queued').length;
    const retrying = this.queue.filter((job) => job.status === 'retrying').length;
    const completed = this.history.filter((job) => job.status === 'completed').length;
    const failed = this.history.filter((job) => job.status === 'failed').length;

    return {
      queued,
      running: this.running,
      completed,
      failed,
      retrying,
    };
  }

  public async drain(timeoutMs = 5_000): Promise<void> {
    const start = Date.now();

    while (this.queue.length > 0 || this.running > 0 || this.processScheduled) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('Timed out waiting for background job queue to drain');
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  public clear(): void {
    this.queue = [];
    this.history = [];
    this.running = 0;
    this.sequence = 0;
    this.processScheduled = false;
  }

  private scheduleProcess(delayMs = 0): void {
    if (delayMs <= 0) {
      if (this.processScheduled) {
        return;
      }

      this.processScheduled = true;
      queueMicrotask(() => {
        this.processScheduled = false;
        this.process();
      });
      return;
    }

    const timer = setTimeout(() => this.process(), delayMs);
    timer.unref?.();
  }

  private process(): void {
    const now = Date.now();

    while (this.running < this.concurrency) {
      const nextJobIndex = this.getNextRunnableJobIndex(now);
      if (nextJobIndex === -1) {
        break;
      }

      const [job] = this.queue.splice(nextJobIndex, 1);
      void this.run(job);
    }

    const nextRunAt = this.queue.reduce<number | null>((earliest, job) => {
      const runAt = job.runAt.getTime();
      return earliest === null || runAt < earliest ? runAt : earliest;
    }, null);

    if (nextRunAt !== null && nextRunAt > Date.now()) {
      this.scheduleProcess(nextRunAt - Date.now());
    }
  }

  private getNextRunnableJobIndex(now: number): number {
    let bestIndex = -1;

    for (let index = 0; index < this.queue.length; index += 1) {
      const job = this.queue[index];
      if (job.runAt.getTime() > now) {
        continue;
      }

      if (bestIndex === -1 || compareJobs(job, this.queue[bestIndex]) < 0) {
        bestIndex = index;
      }
    }

    return bestIndex;
  }

  private async run(job: QueuedJob): Promise<void> {
    this.running += 1;
    job.status = 'running';
    job.attempts += 1;
    job.updatedAt = new Date();

    try {
      await job.handler();
      job.status = 'completed';
      job.updatedAt = new Date();
      this.recordHistory(job);
      logger.debug('Background job completed', {
        jobId: job.id,
        type: job.type,
        attempts: job.attempts,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.lastError = message;
      job.updatedAt = new Date();

      if (job.attempts < job.maxAttempts) {
        job.status = 'retrying';
        const retryDelayMs = calculateRetryDelay(
          job.retryDelayMs,
          job.retryBackoffMultiplier,
          job.attempts
        );
        job.runAt = new Date(Date.now() + retryDelayMs);
        this.queue.push(job);
        logger.warn('Background job failed, retrying', {
          jobId: job.id,
          type: job.type,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          retryDelayMs,
          error: message,
        });
      } else {
        job.status = 'failed';
        this.recordHistory(job);
        logger.error('Background job failed permanently', {
          jobId: job.id,
          type: job.type,
          attempts: job.attempts,
          error: message,
        });
      }
    } finally {
      this.running -= 1;
      this.process();
    }
  }

  private recordHistory(job: QueuedJob): void {
    const {
      handler: _handler,
      retryDelayMs: _retryDelayMs,
      retryBackoffMultiplier: _retryBackoffMultiplier,
      sequence: _sequence,
      ...snapshot
    } = job;
    this.history.push(snapshot);

    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
  }
}

function compareJobs(left: QueuedJob, right: QueuedJob): number {
  const priorityDelta = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const runAtDelta = left.runAt.getTime() - right.runAt.getTime();
  if (runAtDelta !== 0) {
    return runAtDelta;
  }

  return left.sequence - right.sequence;
}

function calculateRetryDelay(
  baseDelayMs: number,
  multiplier: number,
  attemptsCompleted: number
): number {
  return Math.round(baseDelayMs * multiplier ** Math.max(0, attemptsCompleted - 1));
}

function readPositiveInteger(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
