import axios, { AxiosError } from 'axios';
import logger from '@/utils/logger.js';
import type { WebhookEventPayload } from '@/types/realtime.js';

export interface WebhookResult {
  url: string;
  success: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * WebhookSender - Handles HTTP delivery of realtime events to webhook endpoints
 */
export class WebhookSender {
  private readonly timeout = 10000; // 10 seconds
  private readonly maxRetries = 2;

  /**
   * Send event to all webhook URLs in parallel
   */
  async sendToAll(urls: string[], payload: WebhookEventPayload): Promise<WebhookResult[]> {
    const promises = urls.map((url) => this.sendToOne(url, payload));
    return Promise.all(promises);
  }

  /**
   * Send event to a single webhook URL with retry logic
   */
  private async sendToOne(url: string, payload: WebhookEventPayload): Promise<WebhookResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await axios.post(url, payload, {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json',
            'X-InsForge-Event': payload.eventName,
            'X-InsForge-Channel': payload.channel,
            'X-InsForge-Message-Id': payload.messageId,
          },
        });

        return {
          url,
          success: response.status >= 200 && response.status < 300,
          statusCode: response.status,
        };
      } catch (error) {
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
