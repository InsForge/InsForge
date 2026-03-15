import { EmailProvider } from '@/providers/email/base.provider.js';
import { CloudEmailProvider } from '@/providers/email/cloud.provider.js';
import { SMTPEmailProvider } from '@/providers/email/smtp.provider.js';
import { EmailTemplate } from '@/types/email.js';
import { SendRawEmailRequest } from '@insforge/shared-schemas';
import { config } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';

/**
 * Email service that orchestrates different email providers
 */
export class EmailService {
  private static instance: EmailService;
  private provider: EmailProvider;

  private constructor() {
    if (config.email.provider === 'smtp') {
      this.provider = new SMTPEmailProvider();
      logger.info('Using email provider: Custom SMTP');
    } else {
      this.provider = new CloudEmailProvider();
      logger.info('Using email provider: Cloud (Insforge)');
    }
  }

  /**
   * Get singleton instance of EmailService
   */
  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  /**
   * Send email using predefined template
   * @param email - Recipient email address
   * @param name - Recipient name
   * @param template - Template type
   * @param variables - Variables to use in the email template
   */
  public async sendWithTemplate(
    email: string,
    name: string,
    template: EmailTemplate,
    variables?: Record<string, string>
  ): Promise<void> {
    return this.provider.sendWithTemplate(email, name, template, variables);
  }

  /**
   * Send custom/raw email
   * @param options - Email options (to, subject, html, cc, bcc, from, replyTo)
   */
  public async sendRaw(options: SendRawEmailRequest): Promise<void> {
    if (!this.provider.sendRaw) {
      throw new Error('Current email provider does not support raw email sending');
    }
    return this.provider.sendRaw(options);
  }

  /**
   * Check if current provider supports templates
   */
  public supportsTemplates(): boolean {
    return this.provider.supportsTemplates();
  }
}
