import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { EmailTemplate } from '@/types/email.js';
import { SmtpConfigService, RawSmtpConfig } from '@/services/email/smtp-config.service.js';
import { EmailTemplateService } from '@/services/email/email-template.service.js';
import { SendRawEmailRequest } from '@insforge/shared-schemas';
import { EmailProvider } from './base.provider.js';
import logger from '@/utils/logger.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatFromAddress(name: string, email: string): string {
  const safeName = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${safeName}" <${email}>`;
}

export class SmtpEmailProvider implements EmailProvider {
  supportsTemplates(): boolean {
    return true;
  }

  private createTransporter(config: RawSmtpConfig) {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.username, pass: config.password },
      connectionTimeout: 10000,
    });
  }

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
   * Get SMTP config or throw. Shared by all send methods.
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
   * Send an email via SMTP with error handling and transport cleanup.
   */
  private async send(
    config: RawSmtpConfig,
    mailOptions: Mail.Options,
    logContext: Record<string, unknown>
  ): Promise<void> {
    const transporter = this.createTransporter(config);
    try {
      await transporter.sendMail({
        from: formatFromAddress(config.senderName, config.senderEmail),
        ...mailOptions,
      });
      logger.info('Email sent via SMTP', logContext);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown SMTP error';
      logger.error(`Failed to send email via SMTP: ${message}`, logContext);
      throw new AppError(
        `Failed to send email via SMTP: ${message}`,
        500,
        ERROR_CODES.EMAIL_SMTP_SEND_FAILED
      );
    } finally {
      transporter.close();
    }
  }

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

  async sendRaw(options: SendRawEmailRequest): Promise<void> {
    const config = await this.getRequiredConfig();

    await this.send(
      config,
      {
        to: options.to,
        subject: options.subject,
        html: options.html,
        cc: options.cc,
        bcc: options.bcc,
        replyTo: options.replyTo,
      },
      { to: options.to }
    );
  }
}
