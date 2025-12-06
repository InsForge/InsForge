import { EmailProvider } from '@/providers/email/base.provider.js';
import { CloudEmailProvider } from '@/providers/email/cloud.provider.js';
import { EmailTemplate } from '@/types/email.js';
import { SendRawEmailRequest } from '@insforge/shared-schemas';
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
   * Send custom/raw email
   * @param options - Email options (to, subject, html, cc, bcc, from, replyTo)
   */
  public async sendRaw(options: SendRawEmailRequest): Promise<void> {
    return this.provider.sendRaw(options);
  }

  /**
   * Check if current provider supports templates
   */
  public supportsTemplates(): boolean {
    return this.provider.supportsTemplates();
  }
}
