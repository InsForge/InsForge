import jwt from 'jsonwebtoken';
import axios from 'axios';
import { config } from '@/app.config';
import logger from '@/utils/logger';
import { AppError } from '@/api/middleware/error';
import { ERROR_CODES } from '@/types/error-constants';

/**
 * Email template types supported by the cloud backend
 */
export type EmailTemplate = 'email-verification' | 'reset-password' | 'request-otp';

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
   * @param token - Token to use in the email template (verification code, reset link, etc.)
   * @param template - Template type (email-verification or reset-password)
   * @returns Promise that resolves when email is sent successfully
   */
  public async sendWithTemplate(
    email: string,
    name: string,
    token: string,
    template: EmailTemplate
  ): Promise<void> {
    try {
      const projectId = config.cloud.projectId;
      const apiHost = config.cloud.apiHost;
      const signToken = this.generateSignToken();

      // Validate inputs
      if (!email || !name || !token || !template) {
        throw new AppError(
          'Missing required parameters for sending email',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      if (!['email-verification', 'reset-password', 'request-otp'].includes(template)) {
        throw new AppError(
          `Invalid template type: ${template}. Must be 'email-verification' or 'reset-password' or 'request-otp'`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const url = `${apiHost}/email/v1/${projectId}/send-with-template`;

      logger.info('Sending email via cloud backend', {
        email,
        template,
        url,
      });

      const response = await axios.post(
        url,
        {
          email,
          name,
          token,
          template,
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
          email,
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
          email,
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
            ERROR_CODES.INTERNAL_ERROR
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
        email,
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

  /**
   * Send email verification code
   * @param email - Recipient email address
   * @param name - Recipient name
   * @param verificationCode - Verification code to send
   */
  public async sendVerificationEmail(
    email: string,
    name: string,
    verificationCode: string
  ): Promise<void> {
    return this.sendWithTemplate(email, name, verificationCode, 'email-verification');
  }

  /**
   * Send password reset code
   * @param email - Recipient email address
   * @param name - Recipient name
   * @param resetCode - Password reset code to send
   */
  public async sendPasswordResetEmail(
    email: string,
    name: string,
    resetCode: string
  ): Promise<void> {
    return this.sendWithTemplate(email, name, resetCode, 'reset-password');
  }

  /**
   * Send OTP request code
   * @param email - Recipient email address
   * @param name - Recipient name
   * @param otp - One-time password to send
   */
  public async sendOTPRequestEmail(email: string, name: string, otp: string): Promise<void> {
    return this.sendWithTemplate(email, name, otp, 'request-otp');
  }
}
