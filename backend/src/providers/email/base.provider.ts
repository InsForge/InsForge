import { EmailTemplate } from '@/types/email.js';
import { SendRawEmailRequest } from '@insforge/shared-schemas';

export type SendRawEmailOptions = SendRawEmailRequest & { idempotencyKey?: string };

/**
 * Result returned by raw email sends. Carries the provider-assigned message ID
 * so callers can persist the real delivery identifier instead of generating one client-side.
 */
export interface SendRawEmailResult {
  /** Provider-assigned Message-ID (SMTP) or provider API message ID (SendGrid/Mailgun), when available */
  messageId?: string;
}

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
   * Send custom/raw email (optional - not all providers may support this)
   * @param options - Email options (to, subject, html, cc, bcc, from, replyTo, idempotencyKey)
   * @returns Result containing the provider-assigned message ID when available
   */
  sendRaw?(options: SendRawEmailOptions, signal?: AbortSignal): Promise<SendRawEmailResult>;

  /**
   * Check if provider supports template-based emails
   */
  supportsTemplates(): boolean;
}
