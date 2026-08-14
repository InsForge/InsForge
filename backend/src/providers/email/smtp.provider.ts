import { createHash } from 'crypto';
import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import { AppError } from '@/utils/errors.js';
import { EmailTemplate } from '@/types/email.js';
import { SmtpConfigService, RawSmtpConfig } from '@/services/email/smtp-config.service.js';
import { EmailTemplateService } from '@/services/email/email-template.service.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { EmailProvider, SendRawEmailOptions } from './base.provider.js';
import logger from '@/utils/logger.js';

/**
 * Escapes HTML characters in dynamic template variable values.
 *
 * @param value - Unsafe input string
 * @returns HTML-safe escaped string
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes regex special characters in template search tokens.
 *
 * @param str - Input string pattern
 * @returns Escaped regex string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Formats sender name and address for standard RFC 5322 From headers.
 *
 * @param name - Display name of sender
 * @param email - Sender email address
 * @returns Formatted RFC 5322 address string
 */
function formatFromAddress(name: string, email: string): string {
  const safeName = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${safeName}" <${email}>`;
}

/**
 * SMTP Email Provider implementation supporting raw message transmission and template rendering.
 */
export class SmtpEmailProvider implements EmailProvider {
  /**
   * Indicates whether this provider supports system email templates.
   *
   * @returns True
   */
  supportsTemplates(): boolean {
    return true;
  }

  /**
   * Sanitizes an idempotency key using SHA-256 to generate a deterministic, valid RFC 5322 Message-ID local-part.
   *
   * @param key - Raw idempotency key or message identifier
   * @returns Deterministic SHA-256 hex string
   */
  private sanitizeMessageIdKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /**
   * Creates an active Nodemailer transport instance using current SMTP configuration.
   *
   * @param config - Decrypted SMTP credentials and settings
   * @returns Nodemailer Transporter instance
   */
  private createTransporter(config: RawSmtpConfig) {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.username, pass: config.password },
      connectionTimeout: 10000,
    });
  }

  /**
   * Replaces dynamic tokens in HTML email template bodies.
   *
   * @param template - Raw HTML template with variable placeholders
   * @param variables - Key-value map of variable replacements
   * @returns Rendered HTML content
   */
  private renderTemplate(template: string, variables: Record<string, string>): string {
    let rendered = template;
    for (const [key, value] of Object.entries(variables)) {
      let safeValue: string;
      if (key === 'link' && !/^https?:\/\//i.test(value)) {
        logger.error('Rejected non-HTTP link value in email template', { key });
        safeValue = '#';
      } else {
        safeValue = escapeHtml(value);
      }
      const pattern = new RegExp(`\\{\\{\\s*${escapeRegex(key)}\\s*\\}\\}`, 'g');
      rendered = rendered.replace(pattern, safeValue);
    }
    return rendered;
  }

  /**
   * Retrieves active SMTP configuration from database or throws an error.
   *
   * @returns Decrypted RawSmtpConfig
   */
  private async getRequiredConfig(): Promise<RawSmtpConfig> {
    const config = await SmtpConfigService.getInstance().getRawSmtpConfig();
    if (!config) {
      throw new AppError(
        'SMTP is not configured or not enabled',
        500,
        ERROR_CODES.EMAIL_SMTP_CONNECTION_FAILED
      );
    }
    return config;
  }

  /**
   * Sends an email via SMTP transport with pre-send abort verification and logging.
   *
   * @param config - Decrypted SMTP configuration
   * @param mailOptions - Nodemailer mail options
   * @param logContext - Context attributes for structured logging
   * @param signal - Optional AbortSignal checked prior to starting transmission
   * @returns Promise resolving when transmission succeeds
   */
  private async send(
    config: RawSmtpConfig,
    mailOptions: Mail.Options,
    logContext: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<void> {
    const transporter = this.createTransporter(config);

    try {
      if (signal?.aborted) {
        throw new AppError(
          'Email sending aborted due to lost claim',
          500,
          ERROR_CODES.EMAIL_SMTP_SEND_FAILED
        );
      }

      // Phase 1: AbortSignal is checked pre-flight only. In-flight SMTP sends cannot be recalled.
      await transporter.sendMail({
        from: formatFromAddress(config.senderName, config.senderEmail),
        ...mailOptions,
      });

      logger.info('Email sent via SMTP', logContext);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown SMTP error';
      logger.error(`Failed to send email via SMTP: ${message}`, logContext);
      throw error instanceof AppError
        ? error
        : new AppError(
            `Failed to send email via SMTP: ${message}`,
            500,
            ERROR_CODES.EMAIL_SMTP_SEND_FAILED
          );
    } finally {
      transporter.close();
    }
  }

  /**
   * Sends an email populated from a registered system template.
   *
   * @param email - Recipient email address
   * @param name - Recipient display name
   * @param template - System template identifier
   * @param variables - Dynamic variable values
   * @returns Promise resolving when email is delivered
   */
  async sendWithTemplate(
    email: string,
    name: string,
    template: EmailTemplate,
    variables?: Record<string, string>
  ): Promise<void> {
    const config = await this.getRequiredConfig();
    const emailTemplate = await EmailTemplateService.getInstance().getTemplate(template);

    // System variables (name, email) override user-supplied to prevent spoofing
    const allVariables: Record<string, string> = { ...variables, name, email };

    await this.send(
      config,
      {
        to: email,
        subject: this.renderTemplate(emailTemplate.subject, allVariables),
        html: this.renderTemplate(emailTemplate.bodyHtml, allVariables),
      },
      { template, to: email }
    );
  }

  /**
   * Sends a raw email payload directly with optional deterministic Message-ID.
   *
   * @param options - Raw email options including recipient, subject, HTML content, and optional idempotency key
   * @param signal - Optional AbortSignal checked prior to dispatch
   * @returns Promise resolving when email is delivered
   */
  async sendRaw(options: SendRawEmailOptions, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new AppError(
        'Email sending aborted due to lost claim',
        500,
        ERROR_CODES.EMAIL_SMTP_SEND_FAILED
      );
    }
    const config = await this.getRequiredConfig();
    if (signal?.aborted) {
      throw new AppError(
        'Email sending aborted due to lost claim',
        500,
        ERROR_CODES.EMAIL_SMTP_SEND_FAILED
      );
    }

    const messageId = options.idempotencyKey
      ? `<${this.sanitizeMessageIdKey(options.idempotencyKey)}@insforge.messaging>`
      : undefined;

    await this.send(
      config,
      {
        to: options.to,
        subject: options.subject,
        html: options.html,
        cc: options.cc,
        bcc: options.bcc,
        replyTo: options.replyTo,
        messageId,
      },
      { to: options.to },
      signal
    );
  }
}
