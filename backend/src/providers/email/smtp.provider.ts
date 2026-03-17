import nodemailer from 'nodemailer';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { EmailTemplate } from '@/types/email.js';
import { SmtpConfigService, RawSmtpConfig } from '@/services/email/smtp-config.service.js';
import { EmailTemplateService } from '@/services/email/email-template.service.js';
import { SendRawEmailRequest } from '@insforge/shared-schemas';
import { EmailProvider } from './base.provider.js';
import logger from '@/utils/logger.js';

/**
 * HTML-escape a string to prevent XSS in email templates
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
 * SMTP email provider for sending emails via custom SMTP server
 */
export class SmtpEmailProvider implements EmailProvider {
  /**
   * Check if provider supports templates
   */
  supportsTemplates(): boolean {
    return true;
  }

  /**
   * Create a nodemailer transporter from SMTP config
   */
  private createTransporter(config: RawSmtpConfig) {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: {
        user: config.username,
        pass: config.password,
      },
      connectionTimeout: 10000,
    });
  }

  /**
   * Render a template by replacing {{ placeholder }} with variable values
   * HTML-escapes all values except `link` (which is a URL used in href)
   */
  private renderTemplate(
    template: string,
    variables: Record<string, string>
  ): string {
    let rendered = template;
    for (const [key, value] of Object.entries(variables)) {
      const safeValue = key === 'link' ? value : escapeHtml(value);
      // Match {{ key }} with optional whitespace inside braces
      const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
      rendered = rendered.replace(pattern, safeValue);
    }
    return rendered;
  }

  /**
   * Send email using a database-stored template
   */
  async sendWithTemplate(
    email: string,
    name: string,
    template: EmailTemplate,
    variables?: Record<string, string>
  ): Promise<void> {
    const smtpConfig = await SmtpConfigService.getInstance().getRawSmtpConfig();
    if (!smtpConfig) {
      throw new AppError(
        'SMTP is not configured or not enabled',
        500,
        ERROR_CODES.EMAIL_SMTP_CONNECTION_FAILED
      );
    }

    const emailTemplate =
      await EmailTemplateService.getInstance().getTemplate(template);

    const allVariables: Record<string, string> = {
      name,
      email,
      ...variables,
    };

    const renderedSubject = this.renderTemplate(
      emailTemplate.subject,
      allVariables
    );
    const renderedBody = this.renderTemplate(
      emailTemplate.bodyHtml,
      allVariables
    );

    const transporter = this.createTransporter(smtpConfig);

    try {
      await transporter.sendMail({
        from: `"${smtpConfig.senderName}" <${smtpConfig.senderEmail}>`,
        to: email,
        subject: renderedSubject,
        html: renderedBody,
      });

      logger.info('Email sent via SMTP', { template, to: email });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown SMTP error';
      logger.error('Failed to send email via SMTP', {
        template,
        to: email,
        error: message,
      });
      throw new AppError(
        `Failed to send email via SMTP: ${message}`,
        500,
        ERROR_CODES.EMAIL_SMTP_SEND_FAILED
      );
    } finally {
      transporter.close();
    }
  }

  /**
   * Send custom/raw email via SMTP
   * Always uses sender_email/sender_name from SMTP config as `from` (prevents spoofing)
   */
  async sendRaw(options: SendRawEmailRequest): Promise<void> {
    const smtpConfig = await SmtpConfigService.getInstance().getRawSmtpConfig();
    if (!smtpConfig) {
      throw new AppError(
        'SMTP is not configured or not enabled',
        500,
        ERROR_CODES.EMAIL_SMTP_CONNECTION_FAILED
      );
    }

    const transporter = this.createTransporter(smtpConfig);

    try {
      await transporter.sendMail({
        from: `"${smtpConfig.senderName}" <${smtpConfig.senderEmail}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        cc: options.cc,
        bcc: options.bcc,
        replyTo: options.replyTo,
      });

      logger.info('Raw email sent via SMTP', { to: options.to });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown SMTP error';
      logger.error('Failed to send raw email via SMTP', {
        to: options.to,
        error: message,
      });
      throw new AppError(
        `Failed to send email via SMTP: ${message}`,
        500,
        ERROR_CODES.EMAIL_SMTP_SEND_FAILED
      );
    } finally {
      transporter.close();
    }
  }
}
