import nodemailer from 'nodemailer';
import { EmailTemplate } from '@/types/email.js';
import { SendRawEmailRequest } from '@insforge/shared-schemas';
import { EmailProvider } from './base.provider.js';
import logger from '@/utils/logger.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';

/**
 * SMTP email provider for sending emails via custom SMTP servers
 */
export class SMTPEmailProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor() {
    const smtpConfig = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Additional options for TLS/SSL
      tls: {
        // Do not fail on invalid certs (for self-signed certificates)
        rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false',
      },
    };

    // Validate required SMTP configuration
    if (!smtpConfig.host) {
      throw new AppError(
        'SMTP_HOST is required when using SMTP email provider',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    if (!smtpConfig.auth.user || !smtpConfig.auth.pass) {
      throw new AppError(
        'SMTP_USER and SMTP_PASS are required when using SMTP email provider',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    this.transporter = nodemailer.createTransport(smtpConfig);

    logger.info('SMTP email provider initialized', {
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
    });
  }

  /**
   * Check if provider supports templates
   * SMTP provider doesn't support cloud-hosted templates
   */
  supportsTemplates(): boolean {
    return false;
  }

  /**
   * Send email using predefined template
   * Note: SMTP provider doesn't support templates, so this will throw an error
   */
  async sendWithTemplate(
    email: string,
    name: string,
    template: EmailTemplate,
    variables?: Record<string, string>
  ): Promise<void> {
    throw new AppError(
      'SMTP provider does not support template-based emails. Please use sendRaw() instead.',
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }

  /**
   * Send custom/raw email via SMTP
   */
  async sendRaw(options: SendRawEmailRequest): Promise<void> {
    try {
      const { to, subject, html, cc, bcc, from, replyTo } = options;

      // Validate required fields
      if (!to || !subject) {
        throw new AppError(
          'Missing required fields: to and subject are required',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      if (!html) {
        throw new AppError(
          'Missing email body: html content is required',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      // Get default from address from env or use a fallback
      const defaultFrom = process.env.SMTP_FROM || process.env.SMTP_USER;
      const fromAddress = from || defaultFrom;

      // Verify connection configuration
      await this.transporter.verify();

      // Send email
      const info = await this.transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html,
        cc: cc || undefined,
        bcc: bcc || undefined,
        replyTo: replyTo || undefined,
      });

      logger.info('Email sent successfully via SMTP', {
        to,
        subject,
        messageId: info.messageId,
      });
    } catch (error) {
      logger.error('Failed to send email via SMTP', {
        to: options.to,
        subject: options.subject,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        `Failed to send email via SMTP: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }
}
