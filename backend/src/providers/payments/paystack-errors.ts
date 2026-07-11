import { AppError, UpstreamError, getUpstreamStatus } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { PaystackApiError, PaystackKeyValidationError } from './paystack.provider.js';

export function normalizePaystackError(error: unknown): Error {
  if (error instanceof PaystackKeyValidationError) {
    return new AppError(error.message, 400, ERROR_CODES.PAYMENT_CONFIG_INVALID);
  }
  if (error instanceof AppError) {
    return error;
  }
  // Unlike Razorpay's SDK, our fetch-based Paystack client throws a proper
  // `PaystackApiError` (message from the `{ status: false, message }` body plus
  // the HTTP status), so an instanceof check replaces duck-typing here.
  if (!(error instanceof PaystackApiError)) {
    return error instanceof Error ? error : new UpstreamError(error, 'Paystack request failed');
  }

  const status = getUpstreamStatus(error);
  const message = error.message.trim() ? error.message : 'Paystack request failed';

  if (status === 429) {
    return new AppError(message, 429, ERROR_CODES.RATE_LIMITED);
  }
  if (status === 401 || status === 403) {
    return new AppError(message, status, ERROR_CODES.PAYMENT_CONFIG_INVALID);
  }

  // `UpstreamError` derives its message via `getUpstreamErrorMessage`, which
  // reads the top-level `error.message` that `PaystackApiError` carries, and
  // its status from `statusCode` — so both survive normalization intact.
  return new UpstreamError(error, message);
}
