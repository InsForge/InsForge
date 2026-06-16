import { AppError, UpstreamError, getUpstreamStatus } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { RazorpayKeyValidationError } from './razorpay.provider.js';

interface RazorpayErrorLike {
  statusCode?: unknown;
  error?: unknown;
  message?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Razorpay SDK API errors reject with a plain object carrying a numeric
 * `statusCode` and a nested `error` object (`{ code, description, ... }`),
 * rather than an `Error` subclass like Stripe's.
 */
function isRazorpayError(error: unknown): error is RazorpayErrorLike {
  if (!isObject(error)) {
    return false;
  }
  const inner = error.error;
  return (
    typeof error.statusCode === 'number' &&
    isObject(inner) &&
    (typeof inner.code === 'string' || typeof inner.description === 'string')
  );
}

/** The human-readable message lives in `error.error.description`. */
function getRazorpayErrorMessage(error: RazorpayErrorLike, fallbackMessage: string): string {
  const inner = error.error;
  if (isObject(inner) && typeof inner.description === 'string' && inner.description.trim()) {
    return inner.description;
  }
  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  return fallbackMessage;
}

export function normalizeRazorpayError(error: unknown): unknown {
  if (error instanceof RazorpayKeyValidationError) {
    return new AppError(error.message, 400, ERROR_CODES.PAYMENT_CONFIG_INVALID);
  }
  if (error instanceof AppError || !isRazorpayError(error)) {
    return error;
  }

  const status = getUpstreamStatus(error);
  const message = getRazorpayErrorMessage(error, 'Razorpay request failed');

  if (status === 429) {
    return new AppError(message, 429, ERROR_CODES.RATE_LIMITED);
  }
  if (status === 401 || status === 403) {
    return new AppError(message, status, ERROR_CODES.PAYMENT_CONFIG_INVALID);
  }

  // `UpstreamError` re-derives its message via `getUpstreamErrorMessage`, which
  // reads a top-level `error.message` but not Razorpay's nested
  // `error.error.description`. We pass our extracted description as the fallback
  // so it surfaces — Razorpay SDK errors carry no top-level `message`, so the
  // fallback always wins and this stays consistent with the branches above.
  return new UpstreamError(error, message);
}
