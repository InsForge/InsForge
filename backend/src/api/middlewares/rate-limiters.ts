import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError } from './error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import {
  RateLimitConfigService,
  DEFAULT_RATE_LIMIT_CONFIG,
} from '@/services/auth/rate-limit-config.service.js';
import type { RateLimitConfigSchema } from '@insforge/shared-schemas';

/**
 * Store for tracking per-email cooldowns
 * Maps email -> last request timestamp
 */
const emailCooldowns = new Map<string, number>();
const rateLimitConfigService = RateLimitConfigService.getInstance();

const EMAIL_COOLDOWN_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_CONFIG_CACHE_TTL_MS = 30 * 1000; // 30 seconds

type DynamicRateLimitConfig = Pick<
  RateLimitConfigSchema,
  | 'sendEmailOtpMaxRequests'
  | 'sendEmailOtpWindowMinutes'
  | 'verifyOtpMaxAttempts'
  | 'verifyOtpWindowMinutes'
  | 'emailCooldownSeconds'
>;

let cachedConfig: DynamicRateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG };
let cachedConfigTimestamp = 0;
let cachedConfigPromise: Promise<DynamicRateLimitConfig> | null = null;
let cachedConfigVersion = 0;

type RateLimitMiddlewareBundle = {
  key: string;
  sendEmailOtpIpLimiter: ReturnType<typeof rateLimit>;
  verifyOtpIpLimiter: ReturnType<typeof rateLimit>;
  emailCooldownMiddleware: (req: Request, res: Response, next: NextFunction) => void;
};

let activeBundle: RateLimitMiddlewareBundle | null = null;

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

    for (const [email, timestamp] of emailCooldowns.entries()) {
      if (now - timestamp > EMAIL_COOLDOWN_RETENTION_MS) {
        emailCooldowns.delete(email);
      }
    }
  },
  5 * 60 * 1000
);

function getConfigKey(config: DynamicRateLimitConfig): string {
  return [
    config.sendEmailOtpMaxRequests,
    config.sendEmailOtpWindowMinutes,
    config.verifyOtpMaxAttempts,
    config.verifyOtpWindowMinutes,
    config.emailCooldownSeconds,
  ].join(':');
}

function createRateLimitBundle(config: DynamicRateLimitConfig): RateLimitMiddlewareBundle {
  const sendOtpWindowMs = config.sendEmailOtpWindowMinutes * 60 * 1000;
  const verifyOtpWindowMs = config.verifyOtpWindowMinutes * 60 * 1000;

  const sendEmailOtpIpLimiter = rateLimit({
    windowMs: sendOtpWindowMs,
    max: config.sendEmailOtpMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, _res: Response, next: NextFunction) => {
      next(
        new AppError(
          `Too many send email verification requests from this IP. Please try again in ${config.sendEmailOtpWindowMinutes} minute${config.sendEmailOtpWindowMinutes === 1 ? '' : 's'}.`,
          429,
          ERROR_CODES.TOO_MANY_REQUESTS
        )
      );
    },
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  });

  const verifyOtpIpLimiter = rateLimit({
    windowMs: verifyOtpWindowMs,
    max: config.verifyOtpMaxAttempts,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, _res: Response, next: NextFunction) => {
      next(
        new AppError(
          `Too many verification attempts from this IP. Please try again in ${config.verifyOtpWindowMinutes} minute${config.verifyOtpWindowMinutes === 1 ? '' : 's'}.`,
          429,
          ERROR_CODES.TOO_MANY_REQUESTS
        )
      );
    },
    skipSuccessfulRequests: true,
    skipFailedRequests: false,
  });

  const emailCooldownMiddleware = perEmailCooldown(config.emailCooldownSeconds * 1000);

  return {
    key: getConfigKey(config),
    sendEmailOtpIpLimiter,
    verifyOtpIpLimiter,
    emailCooldownMiddleware,
  };
}

async function getDynamicRateLimitConfig(): Promise<DynamicRateLimitConfig> {
  const now = Date.now();

  if (now - cachedConfigTimestamp < RATE_LIMIT_CONFIG_CACHE_TTL_MS) {
    return cachedConfig;
  }

  if (!cachedConfigPromise) {
    const requestVersion = cachedConfigVersion;
    cachedConfigPromise = rateLimitConfigService
      .getConfig()
      .then((config) => ({
        sendEmailOtpMaxRequests: config.sendEmailOtpMaxRequests,
        sendEmailOtpWindowMinutes: config.sendEmailOtpWindowMinutes,
        verifyOtpMaxAttempts: config.verifyOtpMaxAttempts,
        verifyOtpWindowMinutes: config.verifyOtpWindowMinutes,
        emailCooldownSeconds: config.emailCooldownSeconds,
      }))
      .then((config) => {
        if (requestVersion === cachedConfigVersion) {
          cachedConfig = config;
          cachedConfigTimestamp = Date.now();
        }
        return config;
      })
      .catch((error) => {
        logger.error('Failed to load persisted rate-limit config, using safe defaults', { error });
        return { ...DEFAULT_RATE_LIMIT_CONFIG };
      })
      .finally(() => {
        cachedConfigPromise = null;
      });
  }

  return await cachedConfigPromise;
}

async function getRateLimitBundle(): Promise<RateLimitMiddlewareBundle> {
  const config = await getDynamicRateLimitConfig();
  const key = getConfigKey(config);

  if (!activeBundle || activeBundle.key !== key) {
    activeBundle = createRateLimitBundle(config);
    logger.info('Rate limiter bundle refreshed from configuration', { key });
  }

  return activeBundle;
}

/**
 * Force-refresh cached rate-limit settings after admin updates.
 */
export function invalidateRateLimitConfigCache(): void {
  cachedConfigVersion += 1;
  cachedConfigPromise = null;
  cachedConfigTimestamp = 0;
  activeBundle = null;
}

/**
 * Clean up resources for graceful shutdown
 */
export function destroyEmailCooldownInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  emailCooldowns.clear();
  activeBundle = null;
  cachedConfigTimestamp = 0;
  cachedConfigPromise = null;
}

/**
 * Per-IP rate limiter middleware for send email OTP requests.
 * Resolved dynamically from persisted configuration.
 */
export const sendEmailOTPRateLimiter: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  void getRateLimitBundle()
    .then((bundle) => {
      bundle.sendEmailOtpIpLimiter(req, res, next);
    })
    .catch(next);
};

/**
 * Per-IP rate limiter middleware for OTP verification attempts.
 * Resolved dynamically from persisted configuration.
 */
export const verifyOTPRateLimiter: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  void getRateLimitBundle()
    .then((bundle) => {
      bundle.verifyOtpIpLimiter(req, res, next);
    })
    .catch(next);
};

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

const dynamicPerEmailCooldown: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  void getRateLimitBundle()
    .then((bundle) => {
      bundle.emailCooldownMiddleware(req, res, next);
    })
    .catch(next);
};

/**
 * Combined rate limiter for sending email otp requests
 * Applies both per-IP and per-email limits
 */
export const sendEmailOTPLimiter = [sendEmailOTPRateLimiter, dynamicPerEmailCooldown];

/**
 * Rate limiter for OTP verification attempts (email OTP verification)
 * Only per-IP limit, no per-email limit (to allow legitimate retries)
 */
export const verifyOTPLimiter = [verifyOTPRateLimiter];
