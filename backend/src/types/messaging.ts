export type MessageChannel = 'email' | 'sms' | 'push';
export type MessageStatus = 'pending' | 'claimed' | 'sent' | 'failed' | 'dead';

export interface MessagePayload {
  channel: MessageChannel;
  to: string;
  subject?: string;
  body?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface OutboxMessage {
  id: string;
  channel: MessageChannel;
  status: MessageStatus;
  payload: MessagePayload;
  idempotencyKey?: string;
  claimedBy?: string;
  claimedAt?: string;
  leaseExpiresAt?: string;
  claimToken?: string;
  retryCount: number;
  maxRetries: number;
  nextAttemptAt?: string;
  providerMessageId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryAttempt {
  id: string;
  messageId: string;
  attemptNumber: number;
  workerId: string;
  status: MessageStatus;
  providerMessageId?: string;
  errorMessage?: string;
  attemptedAt: string;
  durationMs?: number;
}

export interface WorkerConfig {
  workerId?: string;
  maxConcurrency?: number;
  pollIntervalMs?: number;
}
