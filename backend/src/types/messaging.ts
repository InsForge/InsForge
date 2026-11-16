/**
 * Supported delivery channels for messaging outbox.
 */
export type MessageChannel = 'email' | 'sms' | 'push';

/**
 * Lifecycle status of an outbox message.
 */
export type MessageStatus = 'pending' | 'claimed' | 'sent' | 'failed' | 'dead';

/**
 * Message payload structure for enqueuing jobs.
 */
export interface MessagePayload {
  /** Target message channel */
  channel: MessageChannel;
  /** Primary recipient identifier (e.g. email address or phone number) */
  to: string;
  /** Subject line for email channel */
  subject?: string;
  /** Text or HTML body content */
  body?: string;
  /** Client-provided idempotency key for deduplication */
  idempotencyKey?: string;
  /** Arbitrary metadata associated with the message */
  metadata?: Record<string, unknown>;
}

/**
 * Full database record representation of a message in messaging.outbox.
 */
export interface OutboxMessage {
  /** Unique UUID identifier */
  id: string;
  /** Delivery channel */
  channel: MessageChannel;
  /** Current lifecycle status */
  status: MessageStatus;
  /** Deserialized message payload */
  payload: MessagePayload;
  /** Optional client idempotency key */
  idempotencyKey?: string;
  /** Identifier of the worker holding the active claim */
  claimedBy?: string;
  /** ISO timestamp when the job was claimed */
  claimedAt?: string;
  /** ISO timestamp when the lease expires */
  leaseExpiresAt?: string;
  /** Unique UUID token validating worker lease ownership */
  claimToken?: string;
  /** Number of delivery attempts made */
  retryCount: number;
  /** Maximum number of retries before moving to dead letter queue */
  maxRetries: number;
  /** ISO timestamp for the next scheduled attempt */
  nextAttemptAt?: string;
  /** Provider-assigned message ID */
  providerMessageId?: string;
  /** Last error message encountered during processing */
  errorMessage?: string;
  /** ISO timestamp when record was created */
  createdAt: string;
  /** ISO timestamp when record was last updated */
  updatedAt: string;
}

/**
 * Delivery attempt audit log record in messaging.delivery_attempts.
 */
export interface DeliveryAttempt {
  /** Unique audit attempt UUID */
  id: string;
  /** Associated outbox message UUID */
  messageId: string;
  /** Sequential attempt number */
  attemptNumber: number;
  /** Worker that executed the attempt */
  workerId: string;
  /** Resulting status of attempt */
  status: MessageStatus;
  /** Provider message ID if successfully sent */
  providerMessageId?: string;
  /** Error message if attempt failed */
  errorMessage?: string;
  /** ISO timestamp when attempt took place */
  attemptedAt: string;
  /** Total duration of attempt in milliseconds */
  durationMs?: number;
}

/**
 * Worker configuration options.
 */
export interface WorkerConfig {
  /** Identifier for this worker process */
  workerId?: string;
  /** Maximum concurrent messages processed simultaneously */
  maxConcurrency?: number;
  /** Fallback polling interval in milliseconds */
  pollIntervalMs?: number;
}
