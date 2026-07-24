export type MessageChannel = 'email' | 'sms' | 'push';

export type MessageStatus = 'pending' | 'claimed' | 'sent' | 'delivered' | 'failed' | 'dead';

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
  retryCount: number;
  maxRetries: number;
  nextAttemptAt: string;
  providerMessageId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryAttempt {
  id: string;
  messageId: string;
  workerId: string;
  status: 'sent' | 'failed';
  errorMessage?: string;
  durationMs?: number;
  attemptedAt: string;
}

export interface DeadLetterMessage {
  id: string;
  channel: MessageChannel;
  payload: MessagePayload;
  idempotencyKey?: string;
  retryCount: number;
  maxRetries: number;
  errorMessage?: string;
  createdAt: string;
  movedAt: string;
}

export interface WorkerConfig {
  leaseDurationSeconds: number;
  maxRetryAttempts: number;
  backoffBaseSeconds: number;
  jitterPercent: number;
  reconciliationIntervalSeconds: number;
  listenTimeoutSeconds: number;
}
