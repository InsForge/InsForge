import logger from '@/utils/logger.js';

export enum JobType {
  EMAIL = 'email',
  AUDIT = 'audit',
  USAGE_TRACKING = 'usage-tracking',
  DEPLOYMENT_SYNC = 'deployment-sync',
}

export enum JobPriority {
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
}

export interface Job {
  id: string;
  type: JobType;
  priority: JobPriority;
  payload: Record<string, unknown>;
  retries: number;
  maxRetries: number;
  createdAt: Date;
  scheduledAt?: Date;
}

export interface JobResult {
  success: boolean;
  error?: Error;
  result?: unknown;
}

type JobHandler = (payload: Record<string, unknown>) => Promise<unknown>;

export class JobQueueService {
  private static instance: JobQueueService;

  private queue: Job[] = [];
  private handlers: Map<JobType, JobHandler> = new Map();
  private processing = false;
  private workerConcurrency = 3;
  private maxRetries = 3;
  private retryDelays = [1000, 5000, 15000];
  private pollInterval = 1000;
  private workerInterval: NodeJS.Timeout | null = null;

  private constructor() {
    logger.info('JobQueueService initialized');
  }

  public static getInstance(): JobQueueService {
    if (!JobQueueService.instance) {
      JobQueueService.instance = new JobQueueService();
    }
    return JobQueueService.instance;
  }

  public registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
    logger.info(`Registered handler for job type: ${type}`);
  }

  public enqueue(
    type: JobType,
    payload: Record<string, unknown>,
    priority: JobPriority = JobPriority.NORMAL,
    maxRetries: number = this.maxRetries
  ): string {
    const job: Job = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      type,
      priority,
      payload,
      retries: 0,
      maxRetries,
      createdAt: new Date(),
    };

    this.queue.push(job);
    this.queue.sort((a, b) => a.priority - b.priority);

    logger.debug(`Job enqueued: ${job.id}`, { type, priority });

    return job.id;
  }

  public async processJob(job: Job): Promise<JobResult> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      logger.error(`No handler registered for job type: ${job.type}`);
      return { success: false, error: new Error(`No handler for job type: ${job.type}`) };
    }

    try {
      const result = await handler(job.payload);
      return { success: true, result };
    } catch (error) {
      const err = error as Error;
      logger.error(`Job failed: ${job.id}`, { error: err, type: job.type, retries: job.retries });
      return { success: false, error: err };
    }
  }

  private async processNextJob(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    if (!job) {
      return;
    }

    logger.debug(`Processing job: ${job.id}`, { type: job.type, retries: job.retries });

    const result = await this.processJob(job);

    if (!result.success && job.retries < job.maxRetries) {
      job.retries++;
      const delay = this.retryDelays[Math.min(job.retries - 1, this.retryDelays.length - 1)];

      logger.info(`Scheduling job retry: ${job.id}`, { retry: job.retries, delay });

      setTimeout(() => {
        this.queue.push(job);
        this.queue.sort((a, b) => a.priority - b.priority);
      }, delay);
    } else if (!result.success) {
      logger.error(`Job failed after max retries: ${job.id}`, { type: job.type });
    } else {
      logger.debug(`Job completed: ${job.id}`, { type: job.type });
    }
  }

  private async worker(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    try {
      const batchSize = Math.min(this.workerConcurrency, this.queue.length);
      const jobs = [];

      for (let i = 0; i < batchSize && this.queue.length > 0; i++) {
        jobs.push(this.processNextJob());
      }

      await Promise.all(jobs);
    } finally {
      this.processing = false;
    }
  }

  public start(): void {
    if (this.workerInterval) {
      logger.warn('Job queue worker already running');
      return;
    }

    this.workerInterval = setInterval(() => this.worker(), this.pollInterval);
    logger.info('Job queue worker started');
  }

  public stop(): void {
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
      logger.info('Job queue worker stopped');
    }
  }

  public getStats(): { queued: number; processing: boolean } {
    return {
      queued: this.queue.length,
      processing: this.processing,
    };
  }

  public clearQueue(): void {
    this.queue = [];
    logger.info('Job queue cleared');
  }
}

export const jobQueue = JobQueueService.getInstance();
