import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwilioSmsProvider } from '../../src/providers/sms/twilio.provider.js';
import { ConsoleSmsProvider } from '../../src/providers/sms/console.provider.js';
import type { RawSmsConfig } from '../../src/services/sms/sms-config.service.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import logger from '../../src/utils/logger.js';

const CONFIG: RawSmsConfig = {
  id: '33333333-3333-4333-8333-333333333333',
  enabled: true,
  provider: 'twilio',
  accountSid: 'ACtest',
  authToken: 'secret-token',
  fromNumber: '+15550001111',
  messagingServiceSid: '',
  minIntervalSeconds: 60,
};

describe('TwilioSmsProvider', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts a form-encoded message with Basic auth to the account endpoint', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 });

    await new TwilioSmsProvider().send('+15551234567', 'Your verification code is 123456.', CONFIG);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('ACtest:secret-token').toString('base64')}`
    );
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const params = new URLSearchParams(init.body);
    expect(params.get('To')).toBe('+15551234567');
    expect(params.get('Body')).toBe('Your verification code is 123456.');
    expect(params.get('From')).toBe('+15550001111');
    expect(params.get('MessagingServiceSid')).toBeNull();
  });

  it('prefers the messaging service SID over the from number', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201 });

    await new TwilioSmsProvider().send('+15551234567', 'hi', {
      ...CONFIG,
      messagingServiceSid: 'MGtest',
    });

    const params = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(params.get('MessagingServiceSid')).toBe('MGtest');
    expect(params.get('From')).toBeNull();
  });

  it('maps a Twilio error response to SMS_SEND_FAILED without leaking the body', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ code: 21211, message: "The 'To' number is not valid." }),
    });

    await expect(new TwilioSmsProvider().send('+15551234567', 'hi', CONFIG)).rejects.toMatchObject({
      statusCode: 500,
      code: ERROR_CODES.SMS_SEND_FAILED,
      message: expect.stringContaining('21211'),
    });

    // The message body (which contains the OTP) is never logged.
    const logged = vi.mocked(logger.error).mock.calls.flat().map(String).join(' ');
    expect(logged).not.toContain('hi');
  });

  it('maps a network failure to SMS_SEND_FAILED', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    await expect(new TwilioSmsProvider().send('+15551234567', 'hi', CONFIG)).rejects.toMatchObject({
      code: ERROR_CODES.SMS_SEND_FAILED,
    });
  });

  it('verifies credentials against the account resource', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await new TwilioSmsProvider().verifyCredentials('ACtest', 'secret-token');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACtest.json');
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('ACtest:secret-token').toString('base64')}`
    );
  });

  it('rejects bad credentials with SMS_PROVIDER_CONNECTION_FAILED', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ code: 20003, message: 'Authenticate' }),
    });

    await expect(
      new TwilioSmsProvider().verifyCredentials('ACtest', 'wrong')
    ).rejects.toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.SMS_PROVIDER_CONNECTION_FAILED,
    });
  });
});

describe('ConsoleSmsProvider', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('logs the message instead of sending it outside production', async () => {
    process.env.NODE_ENV = 'development';

    await new ConsoleSmsProvider().send('+15551234567', 'Your verification code is 123456.', {
      ...CONFIG,
      provider: 'console',
    });

    expect(logger.info).toHaveBeenCalledWith(
      '[console-sms] To +15551234567: Your verification code is 123456.'
    );
  });

  it('is hard-disabled in production', async () => {
    process.env.NODE_ENV = 'production';

    await expect(
      new ConsoleSmsProvider().send('+15551234567', 'hi', { ...CONFIG, provider: 'console' })
    ).rejects.toMatchObject({
      code: ERROR_CODES.SMS_PROVIDER_NOT_CONFIGURED,
    });
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('console-sms'));
  });
});
