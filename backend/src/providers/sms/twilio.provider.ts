import { SmsProvider } from '@/providers/sms/base.provider.js';
import type { RawSmsConfig } from '@/services/sms/sms-config.service.js';
import { AppError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';
const REQUEST_TIMEOUT_MS = 10000;

function basicAuthHeader(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
}

/** Extract Twilio's error message from a failed response without throwing */
async function readTwilioError(response: globalThis.Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === 'object' && 'message' in payload) {
      const { message, code } = payload as { message?: unknown; code?: unknown };
      if (typeof message === 'string') {
        return typeof code === 'number' ? `Twilio error ${code}: ${message}` : message;
      }
    }
  } catch {
    // Non-JSON error body — fall through to the generic message
  }
  return `Twilio API error (HTTP ${response.status})`;
}

/**
 * Twilio SMS provider using the Programmable Messaging REST API directly.
 * A single form-encoded POST with Basic auth is the whole integration, so the
 * official SDK is not worth a dependency (matching how the cloud email
 * provider is a thin HTTP client rather than a vendor SDK).
 */
export class TwilioSmsProvider implements SmsProvider {
  async send(to: string, body: string, config: RawSmsConfig): Promise<void> {
    const params = new URLSearchParams({ To: to, Body: body });
    if (config.messagingServiceSid) {
      params.set('MessagingServiceSid', config.messagingServiceSid);
    } else {
      params.set('From', config.fromNumber);
    }

    let response: globalThis.Response;
    try {
      response = await fetch(
        `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: basicAuthHeader(config.accountSid, config.authToken),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error';
      logger.error(`Failed to send SMS via Twilio: ${message}`);
      // send() serves the unauthenticated sign-in path: provider detail stays
      // in the log, callers get a fixed message.
      throw new AppError('Failed to send SMS', 500, ERROR_CODES.SMS_SEND_FAILED);
    }

    if (!response.ok) {
      const message = await readTwilioError(response);
      logger.error(`Failed to send SMS via Twilio: ${message}`, { status: response.status });
      // The detailed reason is admin-visible in the logs only, but the status
      // must keep its retry semantics: a Twilio 429 (account throttled)
      // surfaces as 429 so clients back off, 401/403 (broken stored
      // credentials — an operator fault, nothing the caller did) as 500, and
      // the remaining 4xx (request or recipient rejected) as 400.
      const status =
        response.status === 429
          ? 429
          : response.status === 401 || response.status === 403
            ? 500
            : response.status < 500
              ? 400
              : 500;
      throw new AppError('Failed to send SMS', status, ERROR_CODES.SMS_SEND_FAILED);
    }

    logger.info('SMS sent via Twilio');
  }

  /**
   * Verify the credentials by fetching the account resource.
   * Used by the config save path, mirroring the SMTP `transporter.verify()`
   * check before persisting.
   */
  async verifyCredentials(accountSid: string, authToken: string): Promise<void> {
    let response: globalThis.Response;
    try {
      response = await fetch(`${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}.json`, {
        headers: { Authorization: basicAuthHeader(accountSid, authToken) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error';
      throw new AppError(
        `Twilio connection failed: ${message}`,
        400,
        ERROR_CODES.SMS_PROVIDER_CONNECTION_FAILED
      );
    }

    if (!response.ok) {
      const message = await readTwilioError(response);
      logger.error(`Twilio credential verification failed: ${message}`, {
        status: response.status,
      });
      throw new AppError(
        `Twilio connection failed: ${message}`,
        400,
        ERROR_CODES.SMS_PROVIDER_CONNECTION_FAILED
      );
    }
  }
}
