import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SmtpEmailProvider } from '../../src/providers/email/smtp.provider';
import { AppError } from '../../src/api/middlewares/error';

// Mock dependencies
vi.mock('nodemailer', () => {
  const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test-id' });
  const closeMock = vi.fn();
  return {
    default: {
      createTransport: vi.fn().mockReturnValue({
        sendMail: sendMailMock,
        close: closeMock,
      }),
    },
  };
});

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockSmtpConfig = {
  enabled: true,
  host: 'smtp.example.com',
  port: 465,
  username: 'testuser',
  password: 'testpass',
  senderEmail: 'noreply@example.com',
  senderName: 'Test App',
  minIntervalSeconds: 60,
};

const mockTemplate = {
  id: '00000000-0000-0000-0000-000000000001',
  templateType: 'email-verification-code',
  subject: 'Verify your email',
  bodyHtml: '<p>Your code is: {{ token }}</p><p>Email: {{ email }}</p>',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const getRawSmtpConfigMock = vi.fn().mockResolvedValue(mockSmtpConfig);
const getTemplateMock = vi.fn().mockResolvedValue(mockTemplate);

vi.mock('../../src/services/email/smtp-config.service', () => ({
  SmtpConfigService: {
    getInstance: () => ({
      getRawSmtpConfig: getRawSmtpConfigMock,
    }),
  },
}));

vi.mock('../../src/services/email/email-template.service', () => ({
  EmailTemplateService: {
    getInstance: () => ({
      getTemplate: getTemplateMock,
    }),
  },
}));

describe('SmtpEmailProvider', () => {
  let provider: SmtpEmailProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new SmtpEmailProvider();
  });

  describe('supportsTemplates', () => {
    it('returns true', () => {
      expect(provider.supportsTemplates()).toBe(true);
    });
  });

  describe('sendWithTemplate', () => {
    it('sends email with rendered template', async () => {
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.default.createTransport();

      await provider.sendWithTemplate('user@example.com', 'Test App', 'email-verification-code', {
        token: '123456',
      });

      expect(transport.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '"Test App" <noreply@example.com>',
          to: 'user@example.com',
          subject: 'Verify your email',
          html: expect.stringContaining('123456'),
        })
      );
    });

    it('HTML-escapes placeholder values to prevent XSS', async () => {
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.default.createTransport();

      await provider.sendWithTemplate(
        '<script>alert("xss")</script>@evil.com',
        'Test App',
        'email-verification-code',
        { token: '<img src=x onerror=alert(1)>' }
      );

      expect(transport.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.not.stringContaining('<script>'),
        })
      );

      const callArgs = (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(callArgs.html).toContain('&lt;script&gt;');
    });

    it('throws AppError when SMTP is not configured', async () => {
      getRawSmtpConfigMock.mockResolvedValueOnce(null);

      await expect(
        provider.sendWithTemplate('user@example.com', 'App', 'email-verification-code', {
          token: '123456',
        })
      ).rejects.toThrow(AppError);
    });
  });

  describe('sendRaw', () => {
    it('sends raw email with SMTP sender info (prevents spoofing)', async () => {
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.default.createTransport();

      await provider.sendRaw({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
        from: 'attacker@evil.com', // Should be overridden
      });

      expect(transport.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '"Test App" <noreply@example.com>', // Uses SMTP config, not caller
          to: 'recipient@example.com',
          subject: 'Test Subject',
          html: '<p>Hello</p>',
        })
      );
    });

    it('passes through cc, bcc, and replyTo', async () => {
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.default.createTransport();

      await provider.sendRaw({
        to: 'recipient@example.com',
        subject: 'Test',
        html: '<p>Hi</p>',
        cc: 'cc@example.com',
        bcc: 'bcc@example.com',
        replyTo: 'reply@example.com',
      });

      expect(transport.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          cc: 'cc@example.com',
          bcc: 'bcc@example.com',
          replyTo: 'reply@example.com',
        })
      );
    });

    it('throws AppError when SMTP is not configured', async () => {
      getRawSmtpConfigMock.mockResolvedValueOnce(null);

      await expect(
        provider.sendRaw({
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>Hi</p>',
        })
      ).rejects.toThrow(AppError);
    });
  });
});
