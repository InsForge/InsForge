import logger from '@/utils/logger.js';

// NOTE: This is an in-memory job queue. All pending jobs (verification emails, password resets)
// will be lost on process restart/deploy. For production, consider using database-backed
// storage (e.g., Postgres with a jobs table) for persistence.

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
  retryable?: boolean;
  error?: Error;
  result?: unknown;
}

type JobHandler = (payload: Record<string, unknown>) => Promise<unknown>;

export class JobQueueService {
  private static instance: JobQueueService;

  private queue: Job[] = [];
  private handlers: Map<JobType, JobHandler> = new Map();
  private processing = false;
  private running = false;
  private workerConcurrency = 3;
  private maxRetries = 3;
  private retryDelays = [1000, 5000, 15000];
  private pollInterval = 1000;
  private workerInterval: NodeJS.Timeout | null = null;
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();

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
      return {
        success: false,
        retryable: false,
        error: new Error(`No handler for job type: ${job.type}`),
      };
    }

    try {
      const result = await handler(job.payload);
      return { success: true, result };
    } catch (error) {
      const err = error as Error;
      logger.error(`Job failed: ${job.id}`, { error: err, type: job.type, retries: job.retries });
      return { success: false, retryable: true, error: err };
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

    if (!result.success && result.retryable && job.retries < job.maxRetries) {
      job.retries++;
      const delay = this.retryDelays[Math.min(job.retries - 1, this.retryDelays.length - 1)];

      logger.info(`Scheduling job retry: ${job.id}`, { retry: job.retries, delay });

      const timer = setTimeout(() => {
        this.retryTimers.delete(job.id);
        this.queue.push(job);
        this.queue.sort((a, b) => a.priority - b.priority);
      }, delay);

      this.retryTimers.set(job.id, timer);
    } else if (!result.success) {
      logger.error(`Job failed permanently: ${job.id}`, { type: job.type });
    } else {
      logger.debug(`Job completed: ${job.id}`, { type: job.type });
    }
  }

  private async worker(): Promise<void> {
    if (this.processing || this.queue.length === 0 || !this.running) {
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
    this.running = true;
    if (this.workerInterval) {
      logger.warn('Job queue worker already running');
      return;
    }

    this.workerInterval = setInterval(() => this.worker(), this.pollInterval);
    logger.info('Job queue worker started');
  }

  public getStats(): { queued: number; processing: boolean } {
    return {
      queued: this.queue.length,
      processing: this.processing,
    };
  }

  public clearQueue(): void {
    this.retryTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.retryTimers.clear();
    this.queue = [];
    logger.info('Job queue cleared');
  }

  public async drain(timeoutMs: number = 5000): Promise<void> {
    const startTime = Date.now();

    this.retryTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.retryTimers.clear();

    while ((this.processing || this.queue.length > 0) && Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.queue.length > 0) {
      logger.warn(`Job queue drained with ${this.queue.length} jobs remaining`);
    } else {
      logger.info('Job queue drained');
    }

    this.queue = [];
  }

  public stop(): void {
    this.running = false;
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
    }
    this.retryTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.retryTimers.clear();
    this.queue = [];
    logger.info('Job queue stopped');
  }
}

export const jobQueue = JobQueueService.getInstance();
