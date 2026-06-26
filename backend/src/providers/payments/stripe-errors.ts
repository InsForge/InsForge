import {
  AppError,
  UpstreamError,
  getUpstreamErrorMessage,
  getUpstreamStatus,
} from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { StripeKeyValidationError } from './stripe.provider.js';

interface StripeErrorLike {
  name?: unknown;
  type?: unknown;
  statusCode?: unknown;
  status?: unknown;
  message?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStripeError(error: unknown): error is StripeErrorLike {
  if (!isObject(error)) {
    return false;
  }
  const type = error.type;
  const name = error.name;
  return (
    (typeof type === 'string' && type.startsWith('Stripe')) ||
    (typeof name === 'string' && name.startsWith('Stripe'))
  );
}

export function normalizeStripeError(error: unknown): unknown {
  if (error instanceof StripeKeyValidationError) {
    return new AppError(error.message, 400, ERROR_CODES.PAYMENT_CONFIG_INVALID);
  }
  if (error instanceof AppError || !isStripeError(error)) {
    return error;
  }

  const type = typeof error.type === 'string' ? error.type : '';
  const status = getUpstreamStatus(error);
  const message = getUpstreamErrorMessage(error, 'Stripe request failed');

  if (type === 'StripeRateLimitError' || status === 429) {
    return new AppError(message, 429, ERROR_CODES.RATE_LIMITED);
  }
  if (type === 'StripeAuthenticationError' || type === 'StripePermissionError') {
    return new AppError(message, status, ERROR_CODES.PAYMENT_CONFIG_INVALID);
  }
  if (type === 'StripeCardError') {
    return new AppError(message, status, ERROR_CODES.PAYMENT_METHOD_DECLINED);
  }

  return new UpstreamError(error, 'Stripe request failed');
}
