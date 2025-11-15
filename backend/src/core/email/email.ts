import jwt from 'jsonwebtoken';
import axios from 'axios';
import { config } from '@/app.config';
import logger from '@/utils/logger';
import { AppError } from '@/api/middleware/error';
import { ERROR_CODES } from '@/types/error-constants';

/**
 * Email template types supported by the cloud backend
 */
export type EmailTemplate =
  | 'email-verification-code' // Numeric OTP for email verification
  | 'email-verification-link' // Magic link for email verification
  | 'reset-password-code' // Numeric OTP for password reset
  | 'reset-password-link'; // Magic link for password reset

/**
 * Email service for sending emails via cloud backend
 */
export class EmailService {
  private static instance: EmailService;

  private constructor() {}

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
   * Generate JWT sign token for cloud API authentication
   * @returns JWT token signed with project secret
   */
  private generateSignToken(): string {
    const projectId = config.cloud.projectId;
    const jwtSecret = config.app.jwtSecret;

    if (!projectId || projectId === 'local') {
      throw new AppError(
        'PROJECT_ID is not configured. Cannot send emails without cloud project setup.',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    if (!jwtSecret) {
      throw new AppError(
        'JWT_SECRET is not configured. Cannot generate sign token.',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const payload = {
      sub: projectId,
    };

    return jwt.sign(payload, jwtSecret, {
      expiresIn: '10m', // Short-lived token for API request
    });
  }

  /**
   * Send email using predefined template
   * @param email - Recipient email address
   * @param name - Recipient name
   * @param template - Template type (email-verification or reset-password)
   * @param variables - Variables to use in the email template
   * @returns Promise that resolves when email is sent successfully
   */
  public async sendWithTemplate(
    email: string,
    name: string,
    template: EmailTemplate,
    variables?: Record<string, string>
  ): Promise<void> {
    try {
      const projectId = config.cloud.projectId;
      const apiHost = config.cloud.apiHost;
      const signToken = this.generateSignToken();

      // Validate inputs
      if (!email || !name || !template) {
        throw new AppError(
          'Missing required parameters for sending email',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const validTemplates: EmailTemplate[] = [
        'email-verification-code',
        'email-verification-link',
        'reset-password-code',
        'reset-password-link',
      ];
      if (!validTemplates.includes(template)) {
        throw new AppError(
          `Invalid template type: ${template}. Must be one of: ${validTemplates.join(', ')}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const url = `${apiHost}/email/v1/${projectId}/send-with-template`;
      const response = await axios.post(
        url,
        {
          email,
          name,
          template,
          variables,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            sign: signToken,
          },
          timeout: 10000, // 10 second timeout
        }
      );

      if (response.data?.success) {
        logger.info('Email sent successfully', {
          projectId,
          template,
        });
      } else {
        throw new AppError(
          'Email service returned unsuccessful response',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }
    } catch (error) {
      // Handle axios errors
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const message = error.response?.data?.message || error.message;

        logger.error('Failed to send email via cloud backend', {
          projectId: config.cloud.projectId,
          template,
          status,
          message,
          error: error.response?.data,
        });

        // Provide more specific error messages
        if (status === 401 || status === 403) {
          throw new AppError(
            'Authentication failed with cloud email service. Check PROJECT_ID and JWT_SECRET.',
            status,
            ERROR_CODES.AUTH_UNAUTHORIZED
          );
        } else if (status === 429) {
          throw new AppError(
            'Email rate limit exceeded. Free plans are limited to 3000 emails per month.',
            status,
            ERROR_CODES.RATE_LIMITED
          );
        } else if (status === 400) {
          throw new AppError(
            `Invalid email request: ${message}`,
            status,
            ERROR_CODES.INVALID_INPUT
          );
        } else {
          throw new AppError(
            `Failed to send email: ${message}`,
            status || 500,
            ERROR_CODES.INTERNAL_ERROR
          );
        }
      }

      // Re-throw AppError
      if (error instanceof AppError) {
        throw error;
      }

      // Handle other errors
      logger.error('Unexpected error sending email', {
        projectId: config.cloud.projectId,
        template,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new AppError(
        `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }
}
