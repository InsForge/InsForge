import { EmailProvider } from '@/providers/email/base.provider.js';
import { CloudEmailProvider } from '@/providers/email/cloud.provider.js';
import { EmailTemplate } from '@/types/email.js';
import logger from '@/utils/logger.js';

/**
 * Email service that orchestrates different email providers
 */
export class EmailService {
  private static instance: EmailService;
  private provider: EmailProvider;

  private constructor() {
    // For now, we only support cloud provider
    // In the future, this can be configured via environment variables
    // Example:
    // if (process.env.EMAIL_PROVIDER === 'smtp') {
    //   this.provider = new SMTPEmailProvider(config.email.smtp);
    // } else if (process.env.EMAIL_PROVIDER === 'sendgrid') {
    //   this.provider = new SendGridEmailProvider(config.email.sendgrid);
    // } else {
    //   this.provider = new CloudEmailProvider();
    // }

    this.provider = new CloudEmailProvider();
    logger.info('Using email provider: Cloud (Insforge)');
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
   * Send raw email (if provider supports it)
   * @param to - Recipient email address
   * @param subject - Email subject
   * @param html - HTML email body
   * @param text - Plain text email body (optional)
   */
  public async sendRaw(to: string, subject: string, html: string, text?: string): Promise<void> {
    if (!this.provider.sendRaw) {
      throw new Error('Current email provider does not support raw email sending');
    }
    return this.provider.sendRaw(to, subject, html, text);
  }

  /**
   * Check if current provider supports templates
   */
  public supportsTemplates(): boolean {
    return this.provider.supportsTemplates();
  }
}
