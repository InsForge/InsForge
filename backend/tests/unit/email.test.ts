import { EmailService } from '../../src/core/email/email';
import { AppError } from '../../src/api/middleware/error';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import jwt from 'jsonwebtoken';

// Mock dependencies
vi.mock('axios');
vi.mock('jsonwebtoken');
vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock('../../src/app.config', () => ({
  config: {
    app: {
      jwtSecret: 'test-jwt-secret',
    },
    cloud: {
      projectId: 'test-project-123',
      apiHost: 'https://api.test.com',
    },
  },
}));

describe('EmailService', () => {
  let emailService: EmailService;
  const oldEnv = process.env;

  beforeEach(async () => {
    // Reset all mocks
    vi.resetAllMocks();

    // Mock config values
    const { config } = await import('../../src/app.config');
    config.cloud.projectId = 'test-project-123';
    config.app.jwtSecret = 'test-jwt-secret';
    config.cloud.apiHost = 'https://api.test.com';

    // Get fresh instance
    emailService = EmailService.getInstance();

    // Default mock for jwt.sign
    vi.mocked(jwt.sign).mockReturnValue('mocked-jwt-token' as unknown as string);
  });

  afterEach(() => {
    process.env = oldEnv;
  });

  describe('getInstance', () => {
    it('returns singleton instance', () => {
      const instance1 = EmailService.getInstance();
      const instance2 = EmailService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('sendWithTemplate', () => {
    it('successfully sends email with verification template', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: true },
      });

      await emailService.sendWithTemplate(
        'user@example.com',
        'John Doe',
        '123456',
        'email-verification'
      );

      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'test-project-123' }, 'test-jwt-secret', {
        expiresIn: '10m',
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.test.com/email/v1/test-project-123/send-with-template',
        {
          email: 'user@example.com',
          name: 'John Doe',
          token: '123456',
          template: 'email-verification',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            sign: 'mocked-jwt-token',
          },
          timeout: 10000,
        }
      );
    });

    it('successfully sends email with reset-password template', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: true },
      });

      await emailService.sendWithTemplate(
        'user@example.com',
        'Jane Smith',
        'reset123',
        'reset-password'
      );

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          template: 'reset-password',
          token: 'reset123',
        }),
        expect.any(Object)
      );
    });

    it('successfully sends email with request-otp template', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: true },
      });

      await emailService.sendWithTemplate(
        'user@example.com',
        'Bob Johnson',
        '789012',
        'request-otp'
      );

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          template: 'request-otp',
          token: '789012',
        }),
        expect.any(Object)
      );
    });

    it('throws error if PROJECT_ID is not configured', async () => {
      const { config } = await import('../../src/app.config');
      config.cloud.projectId = 'local';

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', '123456', 'email-verification')
      ).rejects.toThrow(AppError);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', '123456', 'email-verification')
      ).rejects.toThrow('PROJECT_ID is not configured');

      // Reset for other tests
      config.cloud.projectId = 'test-project-123';
    });

    it('throws error if JWT_SECRET is not configured', async () => {
      const { config } = await import('../../src/app.config');
      config.app.jwtSecret = '';

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', '123456', 'email-verification')
      ).rejects.toThrow(AppError);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', '123456', 'email-verification')
      ).rejects.toThrow('JWT_SECRET is not configured');

      // Reset for other tests
      config.app.jwtSecret = 'test-jwt-secret';
    });

    it('throws error if required parameters are missing', async () => {
      await expect(
        emailService.sendWithTemplate('', 'John', '123456', 'email-verification')
      ).rejects.toThrow('Missing required parameters');

      await expect(
        emailService.sendWithTemplate('user@example.com', '', '123456', 'email-verification')
      ).rejects.toThrow('Missing required parameters');

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', '', 'email-verification')
      ).rejects.toThrow('Missing required parameters');
    });

    it('throws error for invalid template type', async () => {
      await expect(
        emailService.sendWithTemplate(
          'user@example.com',
          'John',
          '123456',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'invalid-template' as any
        )
      ).rejects.toThrow('Invalid template type');
    });

    it('throws error if cloud service returns unsuccessful response', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: false },
      });

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', '123456', 'email-verification')
      ).rejects.toThrow('Email service returned unsuccessful response');
    });

    it('handles 401 authentication error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Request failed') as any;
      error.isAxiosError = true;
      error.response = {
        status: 401,
        data: { message: 'Unauthorized' },
      };

      vi.mocked(axios.post).mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', '123456', 'email-verification')
      ).rejects.toThrow('Authentication failed with cloud email service');
    });

    it('handles 403 forbidden error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Request failed') as any;
      error.isAxiosError = true;
      error.response = {
        status: 403,
        data: { message: 'Forbidden' },
      };

      vi.mocked(axios.post).mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', '123456', 'email-verification')
      ).rejects.toThrow('Authentication failed with cloud email service');
    });

    it('handles 429 rate limit error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Request failed') as any;
      error.isAxiosError = true;
      error.response = {
        status: 429,
        data: { message: 'Too many requests' },
      };

      vi.mocked(axios.post).mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', '123456', 'email-verification')
      ).rejects.toThrow('Email rate limit exceeded');
    });

    it('handles 400 bad request error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Request failed') as any;
      error.isAxiosError = true;
      error.response = {
        status: 400,
        data: { message: 'Invalid email format' },
      };

      vi.mocked(axios.post).mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', '123456', 'email-verification')
      ).rejects.toThrow('Invalid email request: Invalid email format');
    });

    it('handles generic axios error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Request failed') as any;
      error.isAxiosError = true;
      error.response = {
        status: 500,
        data: { message: 'Internal server error' },
      };

      vi.mocked(axios.post).mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', '123456', 'email-verification')
      ).rejects.toThrow('Failed to send email: Internal server error');
    });

    it('handles network error without response', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = new Error('Network error') as any;
      error.isAxiosError = true;

      vi.mocked(axios.post).mockRejectedValue(error);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', '123456', 'email-verification')
      ).rejects.toThrow('Failed to send email: Network error');
    });

    it('handles non-axios error', async () => {
      vi.mocked(axios.post).mockRejectedValue(new Error('Unexpected error'));

      await expect(
        emailService.sendWithTemplate('user@example.com', 'John', '123456', 'email-verification')
      ).rejects.toThrow('Failed to send email: Unexpected error');
    });
  });

  describe('sendVerificationEmail', () => {
    it('calls sendWithTemplate with email-verification template', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: true },
      });

      await emailService.sendVerificationEmail('user@example.com', 'John Doe', '123456');

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          template: 'email-verification',
          email: 'user@example.com',
          name: 'John Doe',
          token: '123456',
        }),
        expect.any(Object)
      );
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('calls sendWithTemplate with reset-password template', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: true },
      });

      await emailService.sendPasswordResetEmail('user@example.com', 'Jane Smith', 'reset789');

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          template: 'reset-password',
          email: 'user@example.com',
          name: 'Jane Smith',
          token: 'reset789',
        }),
        expect.any(Object)
      );
    });
  });

  describe('sendOTPRequestEmail', () => {
    it('calls sendWithTemplate with request-otp template', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: true },
      });

      await emailService.sendOTPRequestEmail('user@example.com', 'Bob Johnson', '567890');

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          template: 'request-otp',
          email: 'user@example.com',
          name: 'Bob Johnson',
          token: '567890',
        }),
        expect.any(Object)
      );
    });
  });

  describe('JWT token generation', () => {
    it('generates JWT with correct payload and expiration', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: { success: true },
      });

      await emailService.sendWithTemplate(
        'user@example.com',
        'John Doe',
        '123456',
        'email-verification'
      );

      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'test-project-123' }, 'test-jwt-secret', {
        expiresIn: '10m',
      });
    });
  });
});
