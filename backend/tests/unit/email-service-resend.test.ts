import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks must be hoisted BEFORE the import of EmailService below — vi.mock is
// hoisted automatically.
vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../src/services/email/smtp-config.service', () => ({
  SmtpConfigService: {
    getInstance: () => ({ getRawSmtpConfig: vi.fn().mockResolvedValue(null) }),
  },
}));

const mockResendConfig = {
  id: '00000000-0000-0000-0000-000000000001',
  enabled: true,
  apiKey: 're_test_api_key_123',
  senderEmail: 'noreply@example.com',
  senderName: 'Test App',
};

vi.mock('../../src/services/email/resend-config.service', () => ({
  ResendConfigService: {
    getInstance: () => ({
      getRawResendConfig: vi.fn().mockResolvedValue(mockResendConfig),
    }),
  },
}));

// ResendEmailProvider's send is stubbed so we exercise EmailService's
// orchestration, not the Resend SDK.
const resendSendWithTemplateMock = vi.fn().mockResolvedValue(undefined);
const resendSendRawMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/providers/email/resend.provider', () => ({
  ResendEmailProvider: vi.fn().mockImplementation(() => ({
    supportsTemplates: () => true,
    sendWithTemplate: resendSendWithTemplateMock,
    sendRaw: resendSendRawMock,
  })),
}));

// EmailService is a singleton — clear its rate-limit Map between tests by
// re-importing per test isn't reliable, so we set the singleton's internal
// Map to empty via type-cast.
import { EmailService } from '../../src/services/email/email.service';
import { AppError } from '../../src/utils/errors';

describe('EmailService — Resend provider', () => {
  let svc: EmailService;

  beforeEach(() => {
    vi.clearAllMocks();
    resendSendWithTemplateMock.mockResolvedValue(undefined);
    resendSendRawMock.mockResolvedValue(undefined);
    svc = EmailService.getInstance();
    // Reset the singleton's rate-limit Map between tests.
    (svc as unknown as { lastEmailSentAt: Map<string, number> }).lastEmailSentAt = new Map();
  });

  it('routes sends to Resend when Resend config is present', async () => {
    await svc.sendWithTemplate('user@example.com', 'User', 'email-verification-code', {
      token: '123456',
    });
    expect(resendSendWithTemplateMock).toHaveBeenCalledTimes(1);
  });

  it('throttles per-recipient sends with Resend active (default 60s)', async () => {
    await svc.sendWithTemplate('rate@example.com', 'User', 'email-verification-code', {
      token: 'a',
    });
    expect(resendSendWithTemplateMock).toHaveBeenCalledTimes(1);

    // Immediate second send to the same address must be rate-limited.
    await expect(
      svc.sendWithTemplate('rate@example.com', 'User', 'email-verification-code', {
        token: 'b',
      })
    ).rejects.toThrow(AppError);

    // Provider was NOT called a second time.
    expect(resendSendWithTemplateMock).toHaveBeenCalledTimes(1);
  });

  it('does not throttle sends to different recipients', async () => {
    await svc.sendWithTemplate('alice@example.com', 'A', 'email-verification-code', {
      token: 'a',
    });
    await svc.sendWithTemplate('bob@example.com', 'B', 'email-verification-code', {
      token: 'b',
    });
    expect(resendSendWithTemplateMock).toHaveBeenCalledTimes(2);
  });

  it('throttles per-recipient in sendRaw with Resend active', async () => {
    await svc.sendRaw({
      to: 'raw@example.com',
      subject: 'hi',
      html: '<p>hi</p>',
    });
    expect(resendSendRawMock).toHaveBeenCalledTimes(1);

    await expect(
      svc.sendRaw({ to: 'raw@example.com', subject: 'hi again', html: '<p>hi again</p>' })
    ).rejects.toThrow(AppError);

    expect(resendSendRawMock).toHaveBeenCalledTimes(1);
  });
});
