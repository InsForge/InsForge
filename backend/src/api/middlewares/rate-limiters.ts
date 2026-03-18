import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { RedisStore } from 'rate-limit-redis';
import { AppError } from './error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import { RedisClientService, type AppRedisClient } from '@/infra/cache/redis.client.js';
import {
  RateLimitConfigService,
  DEFAULT_RATE_LIMIT_CONFIG,
} from '@/services/auth/rate-limit-config.service.js';
import type { RateLimitConfigSchema } from '@insforge/shared-schemas';

/**
 * Fallback store for tracking per-email cooldowns when Redis is unavailable
 * Maps email -> last request timestamp
 */
const emailCooldowns = new Map<string, number>();
const rateLimitConfigService = RateLimitConfigService.getInstance();
const redisClientService = RedisClientService.getInstance();

const EMAIL_COOLDOWN_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_CONFIG_CACHE_TTL_MS = 30 * 1000; // 30 seconds
const REDIS_KEY_PREFIX = {
  globalApi: 'rl:api:global:',
  sendOtp: 'rl:auth:send-otp:',
  verifyOtp: 'rl:auth:verify-otp:',
  emailCooldown: 'rl:auth:email-cooldown:',
} as const;

type DynamicRateLimitConfig = Pick<
  RateLimitConfigSchema,
  | 'apiGlobalMaxRequests'
  | 'apiGlobalWindowMinutes'
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
  storeMode: 'redis' | 'memory';
  globalApiLimiter: ReturnType<typeof rateLimit>;
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
    config.apiGlobalMaxRequests,
    config.apiGlobalWindowMinutes,
    config.sendEmailOtpMaxRequests,
    config.sendEmailOtpWindowMinutes,
    config.verifyOtpMaxAttempts,
    config.verifyOtpWindowMinutes,
    config.emailCooldownSeconds,
  ].join(':');
}

function buildRedisStore(client: AppRedisClient, prefix: string): RedisStore {
  return new RedisStore({
    sendCommand: (...args: string[]) => client.sendCommand(args),
    prefix,
  });
}

function buildInMemoryEmailCooldownMiddleware(cooldownSeconds: number): RequestHandler {
  return perEmailCooldown(cooldownSeconds * 1000);
}

function buildRedisEmailCooldownMiddleware(
  redisClient: AppRedisClient,
  cooldownSeconds: number
): RequestHandler {
  const cooldownFallback = buildInMemoryEmailCooldownMiddleware(cooldownSeconds);

  return (req: Request, res: Response, next: NextFunction) => {
    const email = req.body?.email?.toLowerCase();

    if (!email) {
      next();
      return;
    }

    const key = `${REDIS_KEY_PREFIX.emailCooldown}${email}`;

    void redisClient
      .set(key, '1', {
        NX: true,
        EX: cooldownSeconds,
      })
      .then((result) => {
        if (result === 'OK') {
          next();
          return;
        }

        return redisClient.ttl(key).then((ttl) => {
          const remainingSec = ttl > 0 ? ttl : cooldownSeconds;
          next(
            new AppError(
              `Please wait ${remainingSec} seconds before requesting another code for this email`,
              429,
              ERROR_CODES.TOO_MANY_REQUESTS
            )
          );
        });
      })
      .catch((error) => {
        logger.error('Redis cooldown check failed, falling back to in-memory cooldown', { error });
        try {
          cooldownFallback(req, res, next);
        } catch (fallbackError) {
          next(fallbackError);
        }
      });
  };
}

function createRateLimitBundle(
  config: DynamicRateLimitConfig,
  storeMode: 'redis' | 'memory',
  redisClient: AppRedisClient | null
): RateLimitMiddlewareBundle {
  const globalApiWindowMs = config.apiGlobalWindowMinutes * 60 * 1000;
  const sendOtpWindowMs = config.sendEmailOtpWindowMinutes * 60 * 1000;
  const verifyOtpWindowMs = config.verifyOtpWindowMinutes * 60 * 1000;

  const globalApiStore = redisClient
    ? buildRedisStore(redisClient, REDIS_KEY_PREFIX.globalApi)
    : undefined;
  const sendOtpStore = redisClient
    ? buildRedisStore(redisClient, REDIS_KEY_PREFIX.sendOtp)
    : undefined;
  const verifyOtpStore = redisClient
    ? buildRedisStore(redisClient, REDIS_KEY_PREFIX.verifyOtp)
    : undefined;

  const globalApiLimiter = rateLimit({
    windowMs: globalApiWindowMs,
    max: config.apiGlobalMaxRequests,
    ...(globalApiStore ? { store: globalApiStore } : {}),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req: Request) => req.path === '/health' || req.path === '/api/health',
    handler: (_req: Request, _res: Response, next: NextFunction) => {
      next(
        new AppError(
          `Too many API requests from this IP. Please try again in ${config.apiGlobalWindowMinutes} minute${config.apiGlobalWindowMinutes === 1 ? '' : 's'}.`,
          429,
          ERROR_CODES.TOO_MANY_REQUESTS
        )
      );
    },
  });

  const sendEmailOtpIpLimiter = rateLimit({
    windowMs: sendOtpWindowMs,
    max: config.sendEmailOtpMaxRequests,
    ...(sendOtpStore ? { store: sendOtpStore } : {}),
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
    ...(verifyOtpStore ? { store: verifyOtpStore } : {}),
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

  const emailCooldownMiddleware = redisClient
    ? buildRedisEmailCooldownMiddleware(redisClient, config.emailCooldownSeconds)
    : buildInMemoryEmailCooldownMiddleware(config.emailCooldownSeconds);

  return {
    key: `${getConfigKey(config)}:${storeMode}`,
    storeMode,
    globalApiLimiter,
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
    const localPromise = rateLimitConfigService
      .getConfig()
      .then((config) => ({
        apiGlobalMaxRequests: config.apiGlobalMaxRequests,
        apiGlobalWindowMinutes: config.apiGlobalWindowMinutes,
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
        const fallbackConfig = { ...DEFAULT_RATE_LIMIT_CONFIG };
        if (requestVersion === cachedConfigVersion) {
          cachedConfig = fallbackConfig;
          cachedConfigTimestamp = Date.now();
        }
        return fallbackConfig;
      })
      .finally(() => {
        if (cachedConfigPromise === localPromise) {
          cachedConfigPromise = null;
        }
      });

    cachedConfigPromise = localPromise;
  }

  return await cachedConfigPromise;
}

async function getRateLimitBundle(): Promise<RateLimitMiddlewareBundle> {
  const config = await getDynamicRateLimitConfig();
  const redisClient = await redisClientService.getClient();
  const storeMode: 'redis' | 'memory' = redisClient ? 'redis' : 'memory';
  const key = `${getConfigKey(config)}:${storeMode}`;

  if (!activeBundle || activeBundle.key !== key) {
    activeBundle = createRateLimitBundle(config, storeMode, redisClient);
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
 * Global /api rate limiter middleware (per-IP).
 * Resolved dynamically from persisted configuration.
 */
export const globalApiRateLimiter: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  void getRateLimitBundle()
    .then((bundle) => {
      bundle.globalApiLimiter(req, res, next);
    })
    .catch(next);
};

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
