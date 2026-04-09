import { Resend } from 'resend';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { EmailTemplate } from '@/types/email.js';
import { ResendConfigService, RawResendConfig } from '@/services/email/resend-config.service.js';
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
  return `${safeName} <${email}>`;
}

export class ResendEmailProvider implements EmailProvider {
  supportsTemplates(): boolean {
    return true;
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

  private async getRequiredConfig(): Promise<RawResendConfig> {
    const config = await ResendConfigService.getInstance().getRawResendConfig();
    if (!config) {
      throw new AppError(
        'Resend is not configured or not enabled',
        500,
        ERROR_CODES.EMAIL_RESEND_CONNECTION_FAILED
      );
    }
    return config;
  }

  private async send(
    config: RawResendConfig,
    params: {
      to: string | string[];
      subject: string;
      html: string;
      cc?: string | string[];
      bcc?: string | string[];
      replyTo?: string;
    },
    logContext: Record<string, unknown>
  ): Promise<void> {
    const resend = new Resend(config.apiKey);
    const from = formatFromAddress(config.senderName, config.senderEmail);

    const { data, error } = await resend.emails.send({
      from,
      to: Array.isArray(params.to) ? params.to : [params.to],
      subject: params.subject,
      html: params.html,
      cc: params.cc ? (Array.isArray(params.cc) ? params.cc : [params.cc]) : undefined,
      bcc: params.bcc ? (Array.isArray(params.bcc) ? params.bcc : [params.bcc]) : undefined,
      replyTo: params.replyTo,
    });

    if (error) {
      logger.error(`Failed to send email via Resend: ${error.message}`, logContext);
      throw new AppError(
        `Failed to send email via Resend: ${error.message}`,
        500,
        ERROR_CODES.EMAIL_RESEND_SEND_FAILED
      );
    }

    logger.info('Email sent via Resend', { ...logContext, emailId: data?.id });
  }

  async sendWithTemplate(
    email: string,
    name: string,
    template: EmailTemplate,
    variables?: Record<string, string>
  ): Promise<void> {
    const config = await this.getRequiredConfig();
    const emailTemplate = await EmailTemplateService.getInstance().getTemplate(template);

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
