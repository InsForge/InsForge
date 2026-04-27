import { EmailProvider } from '@/providers/email/base.provider.js';
import { CloudEmailProvider } from '@/providers/email/cloud.provider.js';
import { SmtpEmailProvider } from '@/providers/email/smtp.provider.js';
import { ResendEmailProvider } from '@/providers/email/resend.provider.js';
import { SmtpConfigService, RawSmtpConfig } from '@/services/email/smtp-config.service.js';
import { ResendConfigService } from '@/services/email/resend-config.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { EmailTemplate } from '@/types/email.js';
import { SendRawEmailRequest } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

interface ResolvedProvider {
  provider: EmailProvider;
  smtpConfig: RawSmtpConfig | null;
}

/**
 * Email service — resolves provider per-call so config changes take effect without restart.
 * Priority: Resend (if enabled) > SMTP (if enabled) > Cloud (default)
 */
export class EmailService {
  private static instance: EmailService;
  private cloudProvider = new CloudEmailProvider();
  private smtpProvider = new SmtpEmailProvider();
  private resendProvider = new ResendEmailProvider();
  private lastEmailSentAt = new Map<string, number>();

  private constructor() {
    logger.info('EmailService initialized');
  }

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  private async resolveProvider(): Promise<ResolvedProvider> {
    // Resend takes priority — simplest setup (just API key)
    const resendConfig = await ResendConfigService.getInstance().getRawResendConfig();
    if (resendConfig) {
      return { provider: this.resendProvider, smtpConfig: null };
    }

    // SMTP fallback
    const smtpConfig = await SmtpConfigService.getInstance().getRawSmtpConfig();
    if (smtpConfig) {
      return { provider: this.smtpProvider, smtpConfig };
    }

    return { provider: this.cloudProvider, smtpConfig: null };
  }

  // -------------------------------------------------------------------------
  // Rate limiting — check before send, record after success
  // -------------------------------------------------------------------------

  private checkMinInterval(email: string, minIntervalSeconds: number): void {
    if (minIntervalSeconds <= 0) {
      return;
    }

    const now = Date.now();
    const lastSent = this.lastEmailSentAt.get(email);

    if (lastSent && now - lastSent < minIntervalSeconds * 1000) {
      const retryAfter = Math.ceil((minIntervalSeconds * 1000 - (now - lastSent)) / 1000);
      throw new AppError(
        `Too many emails to this address. Retry after ${retryAfter}s.`,
        429,
        ERROR_CODES.RATE_LIMITED
      );
    }
  }

  private recordEmailSent(email: string, minIntervalSeconds: number): void {
    this.lastEmailSentAt.set(email, Date.now());

    // Prune stale entries to prevent unbounded memory growth
    if (this.lastEmailSentAt.size > 10000) {
      const cutoff = Date.now() - minIntervalSeconds * 2000;
      for (const [key, ts] of this.lastEmailSentAt) {
        if (ts < cutoff) {
          this.lastEmailSentAt.delete(key);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  public async sendWithTemplate(
    email: string,
    name: string,
    template: EmailTemplate,
    variables?: Record<string, string>
  ): Promise<void> {
    const { provider, smtpConfig } = await this.resolveProvider();

    if (smtpConfig) {
      this.checkMinInterval(email, smtpConfig.minIntervalSeconds);
    }

    await provider.sendWithTemplate(email, name, template, variables);

    if (smtpConfig) {
      this.recordEmailSent(email, smtpConfig.minIntervalSeconds);
    }
  }

  public async sendRaw(options: SendRawEmailRequest): Promise<void> {
    const { provider, smtpConfig } = await this.resolveProvider();

    const recipients = Array.isArray(options.to) ? options.to : [options.to];

    if (smtpConfig) {
      for (const recipient of recipients) {
        this.checkMinInterval(recipient, smtpConfig.minIntervalSeconds);
      }
    }

    if (!provider.sendRaw) {
      throw new Error('Current email provider does not support raw email sending');
    }
    await provider.sendRaw(options);

    if (smtpConfig) {
      for (const recipient of recipients) {
        this.recordEmailSent(recipient, smtpConfig.minIntervalSeconds);
      }
    }
  }
}
