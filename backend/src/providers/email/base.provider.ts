import { EmailTemplate } from '@/types/email.js';

/**
 * Email provider interface
 * Defines the contract that all email providers must implement
 */
export interface EmailProvider {
  /**
   * Initialize the email provider (optional)
   */
  initialize?(): void | Promise<void>;

  /**
   * Send email using predefined template
   * @param email - Recipient email address
   * @param name - Recipient name
   * @param template - Template type
   * @param variables - Variables to use in the email template
   */
  sendWithTemplate(
    email: string,
    name: string,
    template: EmailTemplate,
    variables?: Record<string, string>
  ): Promise<void>;

  /**
   * Send raw email with custom subject and body
   * Optional - not all providers may support this
   * @param to - Recipient email address
   * @param subject - Email subject
   * @param html - HTML email body
   * @param text - Plain text email body (optional)
   */
  sendRaw?(to: string, subject: string, html: string, text?: string): Promise<void>;

  /**
   * Check if provider supports template-based emails
   */
  supportsTemplates(): boolean;
}
