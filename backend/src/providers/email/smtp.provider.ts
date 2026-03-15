import nodemailer from 'nodemailer';
import { config } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { EmailTemplate } from '@/types/email.js';
import { SendRawEmailRequest } from '@insforge/shared-schemas';
import { EmailProvider } from './base.provider.js';

/**
 * SMTP email provider for sending emails via custom SMTP server
 */
export class SMTPEmailProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.secure,
      auth: {
        user: config.email.smtp.user,
        pass: config.email.smtp.pass,
      },
    });
  }

  /**
   * Check if provider supports templates
   */
  supportsTemplates(): boolean {
    return true;
  }

  /**
   * Send email using basic HTML structure mapped from templates
   * @param email - Recipient email address
   * @param name - Recipient name
   * @param template - Template type
   * @param variables - Variables to use in the email template
   * @returns Promise that resolves when email is sent successfully
   */
  async sendWithTemplate(
    email: string,
    name: string,
    template: EmailTemplate,
    variables?: Record<string, string>
  ): Promise<void> {
    if (!email || !name || !template) {
      throw new AppError(
        'Missing required parameters for sending email',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    let subject = '';
    let html = '';

    switch (template) {
      case 'email-verification-code':
        subject = 'Verify your email address';
        html = `<p>Hi ${name},</p><p>Your verification code is: <strong style="font-size: 1.2em;">${variables?.token}</strong></p><p>This code will expire in 15 minutes.</p>`;
        break;
      case 'email-verification-link':
        subject = 'Verify your email address';
        html = `<p>Hi ${name},</p><p>Please <a href="${variables?.link}" style="color: #0066cc; text-decoration: none; font-weight: bold;">click here</a> to verify your email address.</p><p>This link will expire in 24 hours.</p>`;
        break;
      case 'reset-password-code':
        subject = 'Reset your password';
        html = `<p>Hi ${name},</p><p>Your password reset code is: <strong style="font-size: 1.2em;">${variables?.token}</strong></p><p>This code will expire in 15 minutes.</p>`;
        break;
      case 'reset-password-link':
        subject = 'Reset your password';
        html = `<p>Hi ${name},</p><p>Please <a href="${variables?.link}" style="color: #0066cc; text-decoration: none; font-weight: bold;">click here</a> to reset your password.</p><p>This link will expire in 24 hours.</p>`;
        break;
      default:
        throw new AppError(
          `Invalid template type: ${template}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
    }

    try {
      await this.transporter.sendMail({
        from: `"${config.email.smtp.fromName}" <${config.email.smtp.fromEmail}>`,
        to: email,
        subject,
        html,
      });
      logger.info('Email sent successfully via SMTP', {
        template,
        email,
      });
    } catch (error) {
      logger.error('Failed to send email via SMTP', {
        template,
        email,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new AppError(
        `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  /**
   * Send custom/raw email via SMTP
   */
  async sendRaw(options: SendRawEmailRequest): Promise<void> {
    const formatRecipients = (recipients?: string | string[]): string | undefined => {
      if (!recipients) return undefined;
      return Array.isArray(recipients) ? recipients.join(', ') : recipients;
    };

    try {
      await this.transporter.sendMail({
        from: options.from || `"${config.email.smtp.fromName}" <${config.email.smtp.fromEmail}>`,
        to: formatRecipients(options.to),
        cc: formatRecipients(options.cc),
        bcc: formatRecipients(options.bcc),
        replyTo: options.replyTo,
        subject: options.subject,
        html: options.html,
      });
      logger.info('Raw email sent successfully via SMTP');
    } catch (error) {
      logger.error('Failed to send raw email via SMTP', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new AppError(
        `Failed to send raw email: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }
}
