import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { AppError } from './error';
import { ERROR_CODES } from '@/types/error-constants';

/**
 * Store for tracking per-email cooldowns
 * Maps email -> last request timestamp
 */
const emailCooldowns = new Map<string, number>();

/**
 * Cleanup old cooldown entries every 5 minutes
 */
setInterval(
  () => {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    for (const [email, timestamp] of emailCooldowns.entries()) {
      if (now - timestamp > fiveMinutes) {
        emailCooldowns.delete(email);
      }
    }
  },
  5 * 60 * 1000
);

/**
 * Per-IP rate limiter for email otp requests
 * Prevents brute-force attacks, resource exhaustion, and enumeration from single IP
 *
 * Limits: 5 requests per 15 minutes per IP
 * Counts ALL requests (both successful and failed) to prevent abuse
 */
export const sendEmailOTPRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(
      new AppError(
        'Too many send email verification requests from this IP. Please try again in 15 minutes.',
        429,
        ERROR_CODES.TOO_MANY_REQUESTS
      )
    );
  },
  // Count all requests (both successes and failures) to prevent resource exhaustion and enumeration
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
});

/**
 * Per-IP rate limiter for email OTP verification attempts
 * Prevents brute-force code guessing
 *
 * Limits: 10 attempts per 15 minutes per IP
 */
export const verifyOTPRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 verification attempts per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(
      new AppError(
        'Too many verification attempts from this IP. Please try again in 15 minutes.',
        429,
        ERROR_CODES.TOO_MANY_REQUESTS
      )
    );
  },
  skipSuccessfulRequests: true, // Don't count successful verifications
  skipFailedRequests: false, // Count failed attempts to prevent brute force
});

/**
 * Per-email cooldown middleware
 * Prevents enumeration attacks by enforcing minimum time between requests for same email
 *
 * Cooldown: 60 seconds between requests for same email
 */
export const perEmailCooldown = (cooldownMs: number = 60000) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const email = req.body?.email?.toLowerCase();

    if (!email) {
      // If no email in body, let it pass (will be caught by validation)
      return next();
    }

    const now = Date.now();
    const lastRequest = emailCooldowns.get(email);

    if (lastRequest && now - lastRequest < cooldownMs) {
      const remainingMs = cooldownMs - (now - lastRequest);
      const remainingSec = Math.ceil(remainingMs / 1000);

      throw new AppError(
        `Please wait ${remainingSec} seconds before requesting another code for this email`,
        429,
        ERROR_CODES.TOO_MANY_REQUESTS
      );
    }

    // Update last request time
    emailCooldowns.set(email, now);
    next();
  };
};

/**
 * Combined rate limiter for sending email otp requests
 * Applies both per-IP and per-email limits
 */
export const sendEmailOTPLimiter = [
  sendEmailOTPRateLimiter,
  perEmailCooldown(60000), // 60 second cooldown per email
];

/**
 * Rate limiter for OTP verification attempts (email OTP verification)
 * Only per-IP limit, no per-email limit (to allow legitimate retries)
 */
export const verifyOTPLimiter = [verifyOTPRateLimiter];
