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
  private readonly timeout = 10000; // 10 seconds
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
          timeout: Math.min(this.timeout, limits.timeoutMs),
          maxContentLength: limits.maxResponseBytes,
          maxBodyLength: limits.maxResponseBytes,
          maxRedirects: limits.maxRedirects,
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
        if (error instanceof OutboundUrlPolicyError) {
          logger.warn('Webhook delivery blocked by outbound URL policy', {
            reason: error.reason,
          });
          return {
            url,
            success: false,
            error: error.reason,
          };
        }
        const axiosError = error as AxiosError;
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
