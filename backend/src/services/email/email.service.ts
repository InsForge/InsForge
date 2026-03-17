import { EmailProvider } from '@/providers/email/base.provider.js';
import { CloudEmailProvider } from '@/providers/email/cloud.provider.js';
import { SmtpEmailProvider } from '@/providers/email/smtp.provider.js';
import { SmtpConfigService } from '@/services/email/smtp-config.service.js';
import { EmailTemplate } from '@/types/email.js';
import { SendRawEmailRequest } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

/**
 * Email service that orchestrates different email providers
 * Resolves provider per-call so SMTP config changes take effect without restart
 */
export class EmailService {
  private static instance: EmailService;
  private cloudProvider: CloudEmailProvider;
  private smtpProvider: SmtpEmailProvider;

  private constructor() {
    this.cloudProvider = new CloudEmailProvider();
    this.smtpProvider = new SmtpEmailProvider();
    logger.info('EmailService initialized (cloud + SMTP providers available)');
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
   * Resolve which provider to use based on current SMTP configuration
   * Checked per-call so config changes take effect without restart
   * Falls back to cloud provider on any error checking SMTP config
   */
  private async resolveProvider(): Promise<EmailProvider> {
    try {
      const smtpConfig = await SmtpConfigService.getInstance().getRawSmtpConfig();
      if (smtpConfig) {
        logger.debug('Using SMTP email provider');
        return this.smtpProvider;
      }
    } catch (error) {
      logger.warn('Error checking SMTP config, falling back to cloud provider', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    return this.cloudProvider;
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
    const provider = await this.resolveProvider();
    return provider.sendWithTemplate(email, name, template, variables);
  }

  /**
   * Send custom/raw email
   * @param options - Email options (to, subject, html, cc, bcc, from, replyTo)
   */
  public async sendRaw(options: SendRawEmailRequest): Promise<void> {
    const provider = await this.resolveProvider();
    if (!provider.sendRaw) {
      throw new Error('Current email provider does not support raw email sending');
    }
    return provider.sendRaw(options);
  }

  /**
   * Check if current provider supports templates
   */
  public supportsTemplates(): boolean {
    // Both providers support templates
    return true;
  }
}
