import axios, { AxiosError } from 'axios';
import logger from '@/utils/logger.js';
import type { WebhookMessage } from '@insforge/shared-schemas';
import {
  assertSafeOutboundUrl,
  createOutboundAgents,
  getOutboundRequestLimits,
  OutboundUrlPolicyError,
} from '@/infra/network/outbound-url-policy.js';

export interface WebhookResult {
  url: string;
  success: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * WebhookSender - Handles HTTP delivery of realtime messages to webhook endpoints
 */
export class WebhookSender {
  private readonly maxRetries = 2;

  /**
   * Send message to all webhook URLs in parallel
   */
  async sendToAll(urls: string[], message: WebhookMessage): Promise<WebhookResult[]> {
    const promises = urls.map((url) => this.send(url, message));
    return Promise.all(promises);
  }

  /**
   * Send message to a single webhook URL with retry logic
   */
  private async send(url: string, message: WebhookMessage): Promise<WebhookResult> {
    let lastError: string | undefined;
    const limits = getOutboundRequestLimits();
    const { httpAgent, httpsAgent } = createOutboundAgents();

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await assertSafeOutboundUrl(url);
        const response = await axios.post(url, message.payload, {
          timeout: limits.timeoutMs,
          maxContentLength: limits.maxResponseBytes,
          maxBodyLength: limits.maxRequestBytes,
          maxRedirects: limits.maxRedirects,
          signal: AbortSignal.timeout(limits.timeoutMs),
          httpAgent,
          httpsAgent,
          headers: {
            'Content-Type': 'application/json',
            'X-InsForge-Event': message.eventName,
            'X-InsForge-Channel': message.channel,
            'X-InsForge-Message-Id': message.messageId,
          },
        });

        return {
          url,
          success: response.status >= 200 && response.status < 300,
          statusCode: response.status,
        };
      } catch (error) {
        const axiosError = error as AxiosError;
        const policyError =
          error instanceof OutboundUrlPolicyError
            ? error
            : axiosError.cause instanceof OutboundUrlPolicyError
              ? axiosError.cause
              : null;
        if (
          policyError ||
          (axiosError.cause &&
            typeof axiosError.cause === 'object' &&
            'code' in axiosError.cause &&
            axiosError.cause.code === 'ERR_OUTBOUND_POLICY')
        ) {
          let origin = url;
          try {
            origin = new URL(url).origin;
          } catch {
            // The URL policy already reports malformed URLs.
          }
          logger.warn('Webhook delivery blocked by outbound URL policy', {
            reason: policyError?.reason || 'private or reserved network address',
            origin,
          });
          return {
            url,
            success: false,
            error: policyError?.reason || 'private or reserved network address',
          };
        }
        lastError = axiosError.message;

        if (axiosError.response) {
          // Server responded with error status - don't retry
          return {
            url,
            success: false,
            statusCode: axiosError.response.status,
            error: `HTTP ${axiosError.response.status}`,
          };
        }

        // Network error - retry with backoff
        if (attempt < this.maxRetries) {
          await this.delay(1000 * (attempt + 1)); // 1s, 2s
        }
      }
    }
    logger.warn('Webhook delivery failed after retries', { url, error: lastError });

    return {
      url,
      success: false,
      error: lastError,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
