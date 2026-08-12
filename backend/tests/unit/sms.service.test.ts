import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

const mocks = vi.hoisted(() => ({
  getRawSmsConfig: vi.fn(),
  twilioSend: vi.fn(),
  consoleSend: vi.fn(),
}));

vi.mock('../../src/services/sms/sms-config.service.js', () => ({
  SmsConfigService: {
    getInstance: () => ({
      getRawSmsConfig: mocks.getRawSmsConfig,
    }),
  },
}));

vi.mock('../../src/providers/sms/twilio.provider.js', () => ({
  TwilioSmsProvider: class {
    send = mocks.twilioSend;
  },
}));

vi.mock('../../src/providers/sms/console.provider.js', () => ({
  ConsoleSmsProvider: class {
    send = mocks.consoleSend;
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { SmsService } from '../../src/services/sms/sms.service.js';

const CONFIG = {
  id: '55555555-5555-4555-8555-555555555555',
  enabled: true,
  provider: 'twilio' as const,
  accountSid: `AC${'a'.repeat(32)}`,
  authToken: 'secret',
  fromNumber: '+15550001111',
  messagingServiceSid: '',
  minIntervalSeconds: 0, // no cooldown between test sends
  otpMessageTemplate: 'Your verification code is {{ code }}. It expires in 5 minutes.',
};

describe('SmsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.set(SmsService, 'instance', undefined);
    mocks.getRawSmsConfig.mockResolvedValue(CONFIG);
    mocks.twilioSend.mockResolvedValue(undefined);
    mocks.consoleSend.mockResolvedValue(undefined);
  });

  it('renders the configured template with the code before sending', async () => {
    await SmsService.getInstance().sendSignInCode('+15551234567', '481923');

    expect(mocks.twilioSend).toHaveBeenCalledWith(
      '+15551234567',
      'Your verification code is 481923. It expires in 5 minutes.',
      CONFIG
    );
  });

  it('substitutes every placeholder regardless of spacing', async () => {
    mocks.getRawSmsConfig.mockResolvedValue({
      ...CONFIG,
      otpMessageTemplate: '{{code}} is your code. Again: {{  code  }}',
    });

    await SmsService.getInstance().sendSignInCode('+15551234567', '481923');

    expect(mocks.twilioSend).toHaveBeenCalledWith(
      '+15551234567',
      '481923 is your code. Again: 481923',
      expect.anything()
    );
  });

  it('refuses to send when no provider is configured', async () => {
    mocks.getRawSmsConfig.mockResolvedValue(null);

    await expect(
      SmsService.getInstance().sendSignInCode('+15551234567', '481923')
    ).rejects.toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.SMS_PROVIDER_NOT_CONFIGURED,
    });
    expect(mocks.twilioSend).not.toHaveBeenCalled();
  });

  it('routes to the console provider when configured', async () => {
    mocks.getRawSmsConfig.mockResolvedValue({ ...CONFIG, provider: 'console', authToken: '' });

    await SmsService.getInstance().sendSignInCode('+15551234567', '481923');

    expect(mocks.consoleSend).toHaveBeenCalled();
    expect(mocks.twilioSend).not.toHaveBeenCalled();
  });

  it('enforces the per-number minimum interval', async () => {
    mocks.getRawSmsConfig.mockResolvedValue({ ...CONFIG, minIntervalSeconds: 60 });
    const service = SmsService.getInstance();

    await service.sendSignInCode('+15551234567', '111111');

    await expect(service.sendSignInCode('+15551234567', '222222')).rejects.toMatchObject({
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
    });
    expect(mocks.twilioSend).toHaveBeenCalledTimes(1);
  });
});
