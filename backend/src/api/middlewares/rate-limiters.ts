import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.js';
import { ERROR_CODES } from '@/types/error-constants.js';

/**
 * Store for tracking per-email cooldowns
 * Maps email -> last request timestamp
 */
const emailCooldowns = new Map<string, number>();

/**
 * Cleanup interval reference for graceful shutdown
 */
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Cleanup old cooldown entries every 5 minutes
 */
cleanupInterval = setInterval(
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
 * Clean up resources for graceful shutdown
 */
export function destroyEmailCooldownInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  emailCooldowns.clear();
}

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
 * Per-IP rate limiter for S3 access key management endpoints.
 * These endpoints mint / revoke long-lived credentials, so tight limits
 * prevent credential spraying or key-churn abuse from a single IP.
 *
 * Limits: 20 requests per 15 minutes per IP (shared across POST/GET/DELETE).
 */
export const s3AccessKeyManagementRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(
      new AppError(
        'Too many S3 access key management requests from this IP. Please try again in 15 minutes.',
        429,
        ERROR_CODES.TOO_MANY_REQUESTS
      )
    );
  },
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

/**
 * Per-IP rate limiters for "write" endpoints that ultimately drive an external
 * provider call.
 *
 * Goal: stop a single admin's runaway script from monopolising the platform's
 * shared upstream provider quotas — Vercel `Token creation 32/hr`, Vercel
 * `Deployments per 5min: 120`, Fly `app deletions: 100/min`, Deno
 * `Deployments per hour: 60`, etc.
 *
 * Each provider category gets its own bucket so a noisy compute deploy loop
 * cannot starve a legitimate function update (and vice versa). 3 writes /
 * 5min / IP per category is generous for human-driven CRUD; CI loops are
 * expected to deploy once per commit and stay well below this.
 *
 * Counts ALL requests (skipFailedRequests: false) so a buggy script that
 * loops on a 4xx response can't bypass the cap.
 *
 * Within a category, the budget is shared across every wired endpoint — e.g.
 * a deploy create + an env-var write + a domain add all count toward the
 * same per-IP `deployments` budget.
 *
 * E2E suites that exercise many write endpoints from one IP can opt out by
 * setting `INSFORGE_DISABLE_WRITE_RATE_LIMIT=1`. The check is deliberately
 * an explicit named flag (not `NODE_ENV`) so unit tests still exercise the
 * limiter and prod can never accidentally bypass via test envs.
 */
export type WriteLimiterCategory = 'functions' | 'deployments' | 'compute';

function isWriteRateLimitDisabled(): boolean {
  return process.env.INSFORGE_DISABLE_WRITE_RATE_LIMIT === '1';
}

function createWriteEndpointLimiter(category: WriteLimiterCategory) {
  return rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isWriteRateLimitDisabled(),
    handler: (_req: Request, _res: Response, next: NextFunction) => {
      next(
        new AppError(
          `Too many ${category} write requests. Please wait a few minutes and try again.`,
          429,
          ERROR_CODES.TOO_MANY_REQUESTS
        )
      );
    },
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  });
}

export const functionsWriteLimiter = createWriteEndpointLimiter('functions');
export const deploymentsWriteLimiter = createWriteEndpointLimiter('deployments');
export const computeWriteLimiter = createWriteEndpointLimiter('compute');
