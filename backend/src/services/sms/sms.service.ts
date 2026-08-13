import { SmsProvider } from '@/providers/sms/base.provider.js';
import { ConsoleSmsProvider } from '@/providers/sms/console.provider.js';
import { TwilioSmsProvider } from '@/providers/sms/twilio.provider.js';
import { SmsConfigService, RawSmsConfig } from '@/services/sms/sms-config.service.js';
import { AppError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

/**
 * SMS service — resolves provider per-call so SMS config changes take effect
 * without restart (mirrors EmailService). Unlike email there is no managed
 * cloud fallback: with custom SMS disabled or unconfigured, sends are refused.
 */
export class SmsService {
  private static instance: SmsService;
  private twilioProvider = new TwilioSmsProvider();
  private consoleProvider = new ConsoleSmsProvider();
  // Per-instance by design: InsForge currently runs as a single-instance
  // server (matching EmailService's in-memory interval map). If multi-instance
  // ever lands, both maps move to a shared store together.
  private lastSmsSentAt = new Map<string, number>();

  private constructor() {
    logger.info('SmsService initialized');
  }

  public static getInstance(): SmsService {
    if (!SmsService.instance) {
      SmsService.instance = new SmsService();
    }
    return SmsService.instance;
  }

  private async resolveProvider(): Promise<[SmsProvider, RawSmsConfig]> {
    const config = await SmsConfigService.getInstance().getRawSmsConfig();
    if (!config) {
      throw new AppError(
        'An SMS provider must be configured before phone sign-in can be used.',
        400,
        ERROR_CODES.SMS_PROVIDER_NOT_CONFIGURED
      );
    }
    if (config.provider === 'console') {
      return [this.consoleProvider, config];
    }
    return [this.twilioProvider, config];
  }

  // -------------------------------------------------------------------------
  // Rate limiting — check before send, record after success
  // -------------------------------------------------------------------------

  private checkMinInterval(phone: string, minIntervalSeconds: number): void {
    if (minIntervalSeconds <= 0) {
      return;
    }

    const now = Date.now();
    const lastSent = this.lastSmsSentAt.get(phone);

    if (lastSent && now - lastSent < minIntervalSeconds * 1000) {
      const retryAfter = Math.ceil((minIntervalSeconds * 1000 - (now - lastSent)) / 1000);
      throw new AppError(
        `Too many messages to this number. Retry after ${retryAfter}s.`,
        429,
        ERROR_CODES.RATE_LIMITED
      );
    }
  }

  private recordSmsSent(phone: string, minIntervalSeconds: number): void {
    this.lastSmsSentAt.set(phone, Date.now());

    // Prune stale entries to prevent unbounded memory growth. Anything older
    // than the interval can no longer block a send, so it is safe to drop.
    if (this.lastSmsSentAt.size > 10000) {
      const cutoff = Date.now() - minIntervalSeconds * 1000;
      for (const [key, ts] of this.lastSmsSentAt) {
        if (ts < cutoff) {
          this.lastSmsSentAt.delete(key);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Throw exactly what a send would throw (unconfigured provider or interval
   * cooldown) without any side effects. Callers that rotate state before
   * sending — the OTP upsert replaces the previously delivered code — use this
   * so a doomed send can never invalidate a code the user already holds.
   */
  public async assertCanSend(to: string): Promise<void> {
    const [, config] = await this.resolveProvider();
    this.checkMinInterval(to, config.minIntervalSeconds);
  }

  /**
   * Send a sign-in code, rendering the configured message template.
   * `{{ code }}` is the only variable, mirroring the `{{ token }}` convention
   * of email templates.
   */
  public async sendSignInCode(to: string, code: string): Promise<void> {
    const [provider, config] = await this.resolveProvider();

    const body = config.otpMessageTemplate.replace(/\{\{\s*code\s*\}\}/g, code);

    this.checkMinInterval(to, config.minIntervalSeconds);

    // Reserve the interval slot before awaiting the provider so concurrent
    // sends to the same number cannot both pass the check; release it if
    // delivery fails so a legitimate retry is not locked out.
    this.lastSmsSentAt.set(to, Date.now());
    try {
      await provider.send(to, body, config);
    } catch (error) {
      this.lastSmsSentAt.delete(to);
      throw error;
    }

    this.recordSmsSent(to, config.minIntervalSeconds);
  }
}
