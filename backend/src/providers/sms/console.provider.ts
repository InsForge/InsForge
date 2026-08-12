import { SmsProvider } from '@/providers/sms/base.provider.js';
import type { RawSmsConfig } from '@/services/sms/sms-config.service.js';
import { AppError } from '@/utils/errors.js';
import { isProduction } from '@/utils/environment.js';
import logger from '@/utils/logger.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

/**
 * Development-only SMS provider that logs the message instead of sending it.
 * Printing the message body (including OTP codes) is its entire purpose, which
 * is exactly why it must never run in production — enforced here at send time
 * in addition to the config-save guard.
 */
export class ConsoleSmsProvider implements SmsProvider {
  // async so the production guard rejects instead of throwing synchronously
  async send(to: string, body: string, _config: RawSmsConfig): Promise<void> {
    if (isProduction()) {
      throw new AppError(
        'The console SMS provider is disabled in production',
        500,
        ERROR_CODES.SMS_PROVIDER_NOT_CONFIGURED
      );
    }
    logger.info(`[console-sms] To ${to}: ${body}`);
    return Promise.resolve();
  }
}
